import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { createHash } from 'crypto'
import { rollup } from 'rollup'
import esbuild from 'rollup-plugin-esbuild'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import swc from '@swc/core'

/** @type import("rollup").InputPluginOption */
const plugins = [
    nodeResolve(),
    commonjs(),
    {
        name: 'swc',
        async transform(code, id) {
            const result = await swc.transform(code, {
                filename: id,
                jsc: {
                    externalHelpers: true,
                    parser: { syntax: 'typescript', tsx: true },
                },
                env: {
                    targets: 'defaults',
                    include: ['transform-classes', 'transform-arrow-functions'],
                },
            })
            return result.code
        },
    },
    esbuild({ minify: true }),
]

for (const plug of await readdir('./plugins')) {
    const manifest = JSON.parse(await readFile(`./plugins/${plug}/manifest.json`))
    const outDir = `./dist/${plug}`
    const outPath = `${outDir}/index.js`
    try {
        const bundle = await rollup({
            input: `./plugins/${plug}/${manifest.main}`,
            onwarn: () => {},
            plugins,
        })
        await mkdir(outDir, { recursive: true })
        await bundle.write({
            file: outPath,
            globals(id) {
                if (id.startsWith('@vendetta')) return id.substring(1).replace(/\//g, '.')
                const map = { react: 'window.React' }
                return map[id] || null
            },
            format: 'iife',
            compact: true,
            exports: 'named',
        })
        await bundle.close()

        const toHash = await readFile(outPath)
        manifest.hash = createHash('sha256').update(toHash).digest('hex')
        manifest.main = 'index.js'
        await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest))
        console.log(`Successfully built ${manifest.name}!`)
    } catch (e) {
        console.error('Failed to build plugin...', e)
        process.exit(1)
    }
}
