import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, expect, it, vi} from 'vitest';
import {moveWidget, OverviewWidgets, WidgetGroup} from './OverviewWidgets';

afterEach(() => vi.unstubAllGlobals());

function render(account: string, page = 'health') {
  return renderToStaticMarkup(<OverviewWidgets account={account} page={page}
    groups={[{id: 'metrics', title: 'Metrics', widgets: {sleep: 'Sleep', weight: 'Weight', steps: 'Steps'}}]}>
    <WidgetGroup name="metrics">
      <p key="sleep">Sleep</p><p key="weight">Weight</p><p key="steps">Steps</p>
    </WidgetGroup>
  </OverviewWidgets>);
}

it('restores the account and module order, removes unavailable entries and appends new cards', () => {
  vi.stubGlobal('localStorage', {getItem: (key: string) =>
    key === 'lifehub.widget-order.health.first' ? '{"metrics":["weight","deleted","weight","sleep"]}' : null});
  expect(render('first')).toContain('<p>Weight</p><p>Sleep</p><p>Steps</p>');
  expect(render('second')).toContain('<p>Sleep</p><p>Weight</p><p>Steps</p>');
  expect(render('first', 'books')).toContain('<p>Sleep</p><p>Weight</p><p>Steps</p>');
});

it('can use the default layout with damaged or disabled storage', () => {
  for (const getItem of [() => '{', () => '{"metrics":null}', () => {throw Error('disabled');}]) {
    vi.stubGlobal('localStorage', {getItem});
    expect(render('first')).toContain('<p>Sleep</p><p>Weight</p><p>Steps</p>');
  }
});

it('moves cards to either end without losing items at the boundaries', () => {
  const ids = ['a', 'b', 'c'];
  expect(moveWidget(ids, 'a', 'c')).toEqual(['b', 'c', 'a']);
  expect(moveWidget(ids, 'c', 'a')).toEqual(['c', 'a', 'b']);
  expect(moveWidget(ids, 'a', 'missing')).toBe(ids);
});
