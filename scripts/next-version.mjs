import { readFileSync } from 'node:fs'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const seriesPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const parse = value => versionPattern.test(value) ? value.split('.').map(BigInt) : null

function compare(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function nextVersion(releases, series = '') {
  const latest = releases.filter(release => !release.isDraft && !release.isPrerelease)
    .map(release => parse(release.tagName.replace(/^v/, ''))).filter(Boolean)
    .sort(compare).at(-1)
  if (series) {
    if (!seriesPattern.test(series)) throw new Error('Enter a version series such as 1.2.')
    const selected = parse(series + '.0')
    if (latest && compare(selected, latest) <= 0) {
      throw new Error('Select a newer major or minor version, or leave the series blank for a patch.')
    }
    return selected.join('.')
  }
  return latest ? [latest[0], latest[1], latest[2] + 1n].join('.') : '0.1.0'
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  try {
    console.log(nextVersion(JSON.parse(readFileSync(0, 'utf8')), process.env.RELEASE_SERIES?.trim()))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
