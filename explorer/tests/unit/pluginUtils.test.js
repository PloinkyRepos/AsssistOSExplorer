import test from 'node:test';
import assert from 'node:assert/strict';
import { computeComponentBaseUrl, resolveRuntimeAssetUrl } from '../../utils/pluginUtils.js';

test('computeComponentBaseUrl builds dependency paths', () => {
    const base = computeComponentBaseUrl('agent', 'child', {
        ownerComponent: 'parent',
        isDependency: true
    });
    assert.equal(base, '/agent/IDE-plugins/parent/components/child/child');
});

test('computeComponentBaseUrl handles overrides via custom path', () => {
    const base = computeComponentBaseUrl('agent', 'child', {
        customPath: 'shared/widgets/widget'
    });
    assert.equal(base, '/agent/IDE-plugins/shared/widgets/widget');
});

test('resolveRuntimeAssetUrl ignores absolute urls', () => {
    const value = resolveRuntimeAssetUrl('agent', 'component', 'https://example.com/icon.svg');
    assert.equal(value, 'https://example.com/icon.svg');
});
