import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

// ui/ is the component kit and token floor: it may not reach into the app, the SDK, the
// platform layer, or any Nostr/relay/wallet library. A second host (the CMS) must be able
// to render it with nothing else loaded.
const UI_ROOT = resolve(import.meta.dir)
const IMPORT_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g
const FORBIDDEN = /^(?:@\/|@sdk\/|@platform\/|@nostr-dev-kit\/|applesauce-|nostr-tools|@cashu\/)/

async function list(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (e) => {
			const p = join(dir, e.name)
			if (e.isDirectory()) return list(p)
			return /\.(tsx?|mts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
		}),
	)
	return nested.flat()
}

describe('UI dependency boundary', () => {
	test('ui/ imports nothing from the app, SDK, platform, or protocol libraries', async () => {
		const violations: string[] = []
		for (const file of await list(UI_ROOT)) {
			const src = await readFile(file, 'utf8')
			for (const m of src.matchAll(IMPORT_SPECIFIER)) {
				const spec = m[1] ?? m[2]
				if (!spec) continue
				if (FORBIDDEN.test(spec)) violations.push(`${relative(UI_ROOT, file)} imports ${spec}`)
				if (spec.startsWith('.')) {
					const rel = relative(UI_ROOT, resolve(file, '..', spec))
					if (rel === '..' || rel.startsWith(`..${sep}`)) violations.push(`${relative(UI_ROOT, file)} escapes ui/: ${spec}`)
				}
			}
		}
		expect(violations).toEqual([])
	})
})
