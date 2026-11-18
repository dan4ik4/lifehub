from app.core.database import utcnow


def test_linked_goal_contribution_updates_and_undo(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    goal = client.post('/api/v1/goals', headers=headers, json={'title':'Trip','target_value':1000,'current_value':200,'unit':'PLN'}).json()
    habit_body = {'title':'Save','kind':'count','target':10,'unit':'PLN','goal_id':goal['id'],'contributes':True}
    res = client.post('/api/v1/habits', headers=headers, json=habit_body)
    assert res.status_code == 201, res.text
    habit = res.json()
    def read():
        return client.get('/api/v1/goals/'+goal['id'], headers=headers).json()
    assert read()['progress'] == 20
    for value, total in [(10,210),(25,225),(0,200)]:
        res = client.post('/api/v1/habits/'+habit['id']+'/checkins', headers=headers, json={'day':utcnow().date().isoformat(),'value':value,'version':habit['version']})
        assert res.status_code == 200, res.text
        habit = res.json()
        assert float(read()['total_value']) == total
    assert float(read()['linked_value']) == 0
    # Pure relationship does not contribute values.
    habit_body['contributes'] = False
    res = client.patch('/api/v1/habits/'+habit['id'],headers=headers,json={**habit_body,'version':habit['version']})
    habit=res.json()
    client.post('/api/v1/habits/'+habit['id']+'/checkins',headers=headers,json={'day':utcnow().date().isoformat(),'value':10,'version':habit['version']})
    assert float(read()['total_value']) == 200


def test_contribution_validation_and_goal_deletion(client, make_user, auth_headers):
    headers=auth_headers(make_user())
    other=auth_headers(make_user())
    body={'title':'Trip','target_value':1000,'unit':'PLN'}
    goal=client.post('/api/v1/goals',headers=headers,json=body).json()
    habit_body={'title':'Save','kind':'count','target':10,'unit':'EUR','goal_id':goal['id'],'contributes':True}
    assert client.post('/api/v1/habits',headers=headers,json=habit_body).status_code==422
    habit_body['unit']='PLN'
    assert client.post('/api/v1/habits',headers=other,json=habit_body).status_code==404
    habit=client.post('/api/v1/habits',headers=headers,json=habit_body).json()
    assert client.patch('/api/v1/goals/'+goal['id'],headers=headers,json={**body,'unit':'EUR','version':goal['version']}).status_code==422
    assert client.delete('/api/v1/goals/'+goal['id'],headers=headers,params={'version':goal['version']}).status_code==204
    updated=client.get('/api/v1/habits',headers=headers).json()['items'][0]
    assert updated['id']==habit['id'] and updated['goal_id'] is None and not updated['contributes']


def test_free_cannot_enable_goal_contribution(client, make_user, auth_headers):
    headers=auth_headers(make_user(plan='free',free_modules=['goals_habits']))
    goal=client.post('/api/v1/goals',headers=headers,json={'title':'Trip','target_value':1000,'unit':'PLN'}).json()
    response=client.post('/api/v1/habits',headers=headers,json={'title':'Save','kind':'count','target':10,'unit':'PLN','goal_id':goal['id'],'contributes':True})
    assert response.status_code==403
