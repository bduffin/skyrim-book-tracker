import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { addToast, MAX_TOASTS, removeToast, type Toast } from './toast-queue';

const toast = (id: number): Toast => ({ id, message: `message ${id}` });

describe('toast queue (MI6)', () => {
    test('adds toasts in the order they arrive', () => {
        const queue = addToast(addToast([], toast(1)), toast(2));
        assert.deepEqual(queue, [toast(1), toast(2)]);
    });

    test(`keeps at most ${MAX_TOASTS}, dropping the oldest`, () => {
        let queue: Toast[] = [];
        for (let id = 1; id <= MAX_TOASTS + 2; id++) {
            queue = addToast(queue, toast(id));
        }
        assert.deepEqual(
            queue.map((t) => t.id),
            [3, 4, 5],
        );
    });

    test('removes only the toast it names', () => {
        const queue = [toast(1), toast(2), toast(3)];
        assert.deepEqual(removeToast(queue, 2), [toast(1), toast(3)]);
    });

    test('removing a toast that is already gone changes nothing', () => {
        const queue = [toast(1)];
        assert.deepEqual(removeToast(queue, 9), queue);
    });

    test('never mutates the queue it is given', () => {
        const queue = Object.freeze([toast(1)]);
        addToast(queue, toast(2));
        removeToast(queue, 1);
        assert.deepEqual(queue, [toast(1)]);
    });
});
