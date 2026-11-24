import assert from 'node:assert/strict'
import test from 'node:test'
import { nextVersion } from '../scripts/next-version.mjs'

test('releases increment the patch or reset it for a new major or minor', () => {
  const releases = [
    { tagName: 'v1.4.7' }, { tagName: 'v1.4.10' },
    { tagName: 'v9.0.0', isDraft: true }, { tagName: 'v8.0.0', isPrerelease: true },
  ]
  assert.equal(nextVersion([]), '0.1.0')
  assert.equal(nextVersion(releases), '1.4.11')
  assert.equal(nextVersion(releases, '1.5'), '1.5.0')
  assert.equal(nextVersion(releases, '2.0'), '2.0.0')
  assert.throws(() => nextVersion(releases, '1.4'), /newer/)
  assert.throws(() => nextVersion(releases, 'v2.0'), /version series/)
})
