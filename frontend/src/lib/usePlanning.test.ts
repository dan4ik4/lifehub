import { describe, expect, it, vi } from 'vitest';
import { allPages } from './usePlanning';
import { api } from './api';

vi.mock('./api', () => ({ api: vi.fn() }));

describe('planning pagination', () => {
  it('includes task 101 and preserves existing query filters on subsequent pages', async () => {
    const firstPage = Array.from({length: 100}, (_, i) => i + 1);
    const request = vi.mocked(api);
    request.mockResolvedValueOnce({items: firstPage, next_cursor: 'next/page'})
      .mockResolvedValueOnce({items: [101], next_cursor: null});

    expect(await allPages<number>('/planning/tasks?completed=false')).toEqual([...firstPage, 101]);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/planning/tasks?completed=false&limit=100',
      '/planning/tasks?completed=false&limit=100&cursor=next%2Fpage',
    ]);
  });
});
