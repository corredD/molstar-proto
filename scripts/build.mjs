/**
 * Copyright (c) 2017-2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Eric E <etongfu@@outlook.com>
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as argparse from 'argparse';
import { sassPlugin } from 'esbuild-sass-plugin';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';

const Apps = [
    // Apps
    { kind: 'app', name: 'viewer', themes: ['light', 'dark', 'blue'] },
    { kind: 'app', name: 'docking-viewer' },
    { kind: 'app', name: 'mesoscale-explorer' },
    { kind: 'app', name: 'mvs-stories', globalName: 'mvsStories', filename: 'mvs-stories.js' },
    { kind: 'app', name: 'virus-on-the-rock' },

    // Examples
    { kind: 'example', name: 'proteopedia-wrapper' },
    { kind: 'example', name: 'basic-wrapper' },
    { kind: 'example', name: 'lighting' },
    { kind: 'example', name: 'alpha-orbitals' },
    { kind: 'example', name: 'alphafolddb-pae' },
    { kind: 'example', name: 'mvs-stories' },
    { kind: 'example', name: 'ihm-restraints' },
    { kind: 'example', name: 'interactions' },
    { kind: 'example', name: 'ligand-editor' },
];

function findApp(name, kind) {
    return Apps.find(a => a.name === name && a.kind === kind);
}

function mkDir(dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
        process.exit(1);
    }
}

function handleFileError(error, operation, path) {
    console.error(`Failed to ${operation} ${path}:`, error);
    process.exit(1);
}

const DevReloadTokenPath = path.resolve('./build/.dev-reload.txt');
const DevReloadPollIntervalMs = 1000;
let devReloadUpdateHandle = void 0;

function ensureDevReloadTokenFile() {
    if (isProduction) return;
    mkDir(path.dirname(DevReloadTokenPath));
    fs.writeFileSync(DevReloadTokenPath, `${Date.now()}\n`);
}

function scheduleDevReloadTokenUpdate() {
    if (isProduction) return;

    if (devReloadUpdateHandle !== void 0) clearTimeout(devReloadUpdateHandle);
    devReloadUpdateHandle = setTimeout(() => {
        devReloadUpdateHandle = void 0;
        fs.writeFileSync(DevReloadTokenPath, `${Date.now()}\n`);
    }, 100);
}

function getDevReloadSnippet() {
    return `
<script id="__MOLSTAR_DEV_LIVE_RELOAD__" type="text/javascript">
(() => {
    const tokenUrl = window.location.origin + '/build/.dev-reload.txt';
    let currentToken = null;

    async function checkForReload() {
        try {
            const response = await fetch(tokenUrl + '?t=' + Date.now(), { cache: 'no-store' });
            if (!response.ok) return;

            const nextToken = (await response.text()).trim();
            if (!nextToken) return;

            if (currentToken === null) {
                currentToken = nextToken;
                return;
            }

            if (nextToken !== currentToken) {
                window.location.reload();
            }
        } catch {
            // Ignore transient fetch failures while the dev server restarts.
        }
    }

    window.setInterval(checkForReload, ${DevReloadPollIntervalMs});
    checkForReload();
})();
</script>`;
}

function injectDevReloadSnippet(html) {
    if (isProduction || html.includes('__MOLSTAR_DEV_LIVE_RELOAD__')) return html;

    const snippet = getDevReloadSnippet();
    if (html.includes('</body>')) return html.replace('</body>', `${snippet}\n    </body>`);
    if (html.includes('</head>')) return html.replace('</head>', `${snippet}\n    </head>`);
    return `${html}\n${snippet}`;
}

function devReloadPlugin() {
    return {
        name: 'dev-reload',
        setup(build) {
            build.onEnd((result) => {
                if (result.errors.length === 0) scheduleDevReloadTokenUpdate();
            });
        },
    };
}

function fileLoaderPlugin(options) {
    mkDir(options.out);

    return {
        name: 'file-loader',
        setup(build) {
            build.onLoad({ filter: /\.jpg$/ }, async (args) => {
                try {
                    const name = path.basename(args.path);
                    mkDir(path.resolve(options.out, 'images'));
                    await fs.promises.copyFile(args.path, path.resolve(options.out, 'images', name));
                    return {
                        contents: `images/${name}`,
                        loader: 'text',
                    };
                } catch (error) {
                    handleFileError(error, 'copy', args.path);
                }
            });
            build.onLoad({ filter: /\.(html|ico)$/ }, async (args) => {
                const name = path.basename(args.path);
                const outPath = path.resolve(options.out, name);
                if (args.path.endsWith('.html')) {
                    const html = await fs.promises.readFile(args.path, 'utf8');
                    await fs.promises.writeFile(outPath, injectDevReloadSnippet(html));
                } else {
                    await fs.promises.copyFile(args.path, outPath);
                }
                return {
                    contents: '',
                    loader: 'empty',
                };
            });
        },
    };
}

function examplesCssRenamePlugin({ root }) {
    return {
        name: 'example-css-rename',
        setup(build) {
            build.onEnd(async () => {
                if (fs.existsSync(path.resolve(root, 'index.css'))) {
                    await fs.promises.rename(
                        path.resolve(root, 'index.css'),
                        path.resolve(root, 'molstar.css')
                    );
                }
            });
        }
    };
}

function resolveEntryPath(path) {
    if (!fs.existsSync(path)) {
        return path + 'x'; // fallback to .tsx
    }
    return path;
}

function getPaths(app) {
    if (app.kind === 'app') {
        return {
            prefix: `./build/${app.name}`,
            entry: resolveEntryPath(`./src/apps/${app.name}/index.ts`),
            outfile: `./build/${app.name}/${app.filename || 'molstar.js'}`,
        };
    }
    if (app.kind === 'example') {
        return {
            prefix: `./build/examples/${app.name}`,
            entry: resolveEntryPath(`./src/examples/${app.name}/index.ts`),
            outfile: `./build/examples/${app.name}/${app.filename || 'index.js'}`,
        };
    }
    if (app.kind === 'browser-test') {
        return {
            prefix: `./build/tests/browser`,
            entry: resolveEntryPath(`./src/tests/browser/${app.name}.ts`),
            outfile: `./build/tests/browser/${app.name}.js`,
        };
    }
    throw new Error(`Unknown app kind: ${app.kind}`);
}

async function createBundle(app) {
    const { name, kind } = app;
    const { prefix, entry, outfile } = getPaths(app);

    const ctx = await esbuild.context({
        entryPoints: [entry],
        tsconfig: './tsconfig.json',
        bundle: true,
        minify: isProduction,
        minifyIdentifiers: false,
        sourcemap: includeSourceMap,
        globalName: app.globalName || 'molstar',
        outfile,
        plugins: [
            fileLoaderPlugin({ out: prefix }),
            ...(!isProduction ? [devReloadPlugin()] : []),
            sassPlugin({
                type: 'css',
                silenceDeprecations: ['import'],
                logger: {
                    warn: (msg) => console.warn(msg),
                    debug: () => { },
                }
            }),
            ...(kind === 'example' ? [examplesCssRenamePlugin({ root: prefix })] : []),
        ],
        external: ['crypto', 'fs', 'path', 'stream'],
        loader: {
        },
        color: true,
        logLevel: 'info',
        define: {
            'process.env.NODE_ENV': JSON.stringify(NODE_ENV_PRD ? 'production' : 'development'),
            'process.env.DEBUG': JSON.stringify(process.env.DEBUG || false),
            __MOLSTAR_PLUGIN_VERSION__: JSON.stringify(VERSION),
            __MOLSTAR_BUILD_TIMESTAMP__: `${TIMESTAMP}`,
        },
    });

    await ctx.rebuild();

    if (!isProduction) await ctx.watch();
}

async function createTheme(appName, themeName) {
    // const { prefix, entry, outfile } = getPaths(app);

    const ctx = await esbuild.context({
        entryPoints: [resolveEntryPath(`./src/apps/${appName}/theme/${themeName}.ts`)],
        tsconfig: './tsconfig.json',
        bundle: true,
        minify: isProduction,
        minifyIdentifiers: false,
        sourcemap: false,
        outfile: `./build/${appName}/theme/${themeName}.js`,
        plugins: [
            // fileLoaderPlugin({ out: prefix }),
            ...(!isProduction ? [devReloadPlugin()] : []),
            sassPlugin({
                type: 'css',
                silenceDeprecations: ['import'],
                logger: {
                    warn: (msg) => console.warn(msg),
                    debug: () => { },
                }
            }),
        ],
        color: true,
        logLevel: 'info',
        define: {
            'process.env.NODE_ENV': JSON.stringify(NODE_ENV_PRD ? 'production' : 'development'),
            'process.env.DEBUG': JSON.stringify(process.env.DEBUG || false),
        },
    });

    await ctx.rebuild();

    if (!isProduction) await ctx.watch();
}

function findBrowserTests(names) {
    const dir = path.resolve('./src', 'tests', 'browser');
    let files = fs.readdirSync(dir).filter(file => file.endsWith('.ts')).map(file => file.replace('.ts', ''));
    if (names.length) {
        files = files.filter(file => names.includes(file));
    }
    return files.map(name => ({ kind: 'browser-test', name }));
}

const argParser = new argparse.ArgumentParser({
    add_help: true,
    description: 'Mol* Build'
});
argParser.add_argument('--prd', {
    help: 'Create a production build.',
    required: false,
    action: 'store_true',
});
argParser.add_argument('--no-src-map', {
    help: 'Do not include source map.',
    required: false,
    action: 'store_true',
});
argParser.add_argument('--apps', '-a', {
    help: 'Apps to build.',
    required: false,
    nargs: '*',
});
argParser.add_argument('--examples', '-e', {
    help: 'Examples to build.',
    required: false,
    nargs: '*',
});
argParser.add_argument('--browser-tests', '-bt', {
    help: 'Browser Tests to build.',
    required: false,
    nargs: '*',
});
argParser.add_argument('--port', '-p', {
    help: 'Port.',
    required: false,
    default: 1338,
    type: 'int',
});

argParser.add_argument('--host', {
    help: 'Show all available host addresses.',
    required: false,
    action: 'store_true',
});

const args = argParser.parse_args();


const isProduction = !!args.prd;
const includeSourceMap = !args.no_src_map;

const NODE_ENV_PRD = isProduction || process.env.NODE_ENV === 'production';
const VERSION = isProduction ? JSON.parse(fs.readFileSync('./package.json', 'utf8')).version : '(dev build)';
const TIMESTAMP = Date.now();

const apps = (!args.apps ? [] : (args.apps.length ? args.apps.map(a => findApp(a, 'app')).filter(a => a) : Apps.filter(a => a.kind === 'app')));
const examples = (!args.examples ? [] : (args.examples.length ? args.examples.map(e => findApp(e, 'example')).filter(a => a) : Apps.filter(a => a.kind === 'example')));
const browserTests = (!args.browser_tests ? [] : findBrowserTests(args.browser_tests));

console.log('Apps:', apps.map(a => a.name));
console.log('Examples:', examples.map(e => e.name));
console.log('Browser Tests', browserTests.map(e => e.name));
console.log('');

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.internal || iface.family !== 'IPv4') continue;
            ips.push(iface.address);
        }
    }

    return ips;
}

async function main() {
    const promises = [];
    console.log(isProduction ? 'Building apps...' : 'Initial build...');

    ensureDevReloadTokenFile();

    for (const app of apps) {
        promises.push(createBundle(app));
        if (app.themes) {
            for (const theme of app.themes) {
                promises.push(createTheme(app.name, theme));
            }
        }
    }
    for (const example of examples) promises.push(createBundle(example));
    for (const browserTest of browserTests) promises.push(createBundle(browserTest));

    await Promise.all(promises);

    if (isProduction) {
        console.log('Done.');
        process.exit(0);
    }

    console.log('Initial build complete.');

    const certfile = './dev.pem';
    const keyfile = './dev-key.pem';

    const sslEnabled = fs.existsSync(certfile) && fs.existsSync(keyfile);
    const protocol = sslEnabled ? 'https' : 'http';
    const requestHandler = (req, res) => {
        const url = new URL(req.url || '/', `${protocol}://localhost:${args.port}`);
        let requestPath = decodeURIComponent(url.pathname);
        if (requestPath === '/') requestPath = '/build/virus-on-the-rock/';

        let filePath = path.resolve('.', `.${requestPath}`);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === '.html' ? 'text/html; charset=utf-8'
            : ext === '.js' ? 'text/javascript; charset=utf-8'
                : ext === '.css' ? 'text/css; charset=utf-8'
                    : ext === '.json' ? 'application/json; charset=utf-8'
                        : ext === '.svg' ? 'image/svg+xml'
                            : ext === '.ico' ? 'image/x-icon'
                                : ext === '.map' ? 'application/json; charset=utf-8'
                                    : ext === '.txt' ? 'text/plain; charset=utf-8'
                                        : 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(filePath).pipe(res);
    };
    const server = sslEnabled
        ? https.createServer({
            cert: fs.readFileSync(certfile),
            key: fs.readFileSync(keyfile),
        }, requestHandler)
        : http.createServer(requestHandler);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(args.port, '0.0.0.0', () => resolve());
    });

    console.log('');
    console.log(`Server URL: ${protocol}://localhost:${args.port}`);
    if (args.host) {
        console.log('Available host addresses:');
        const ips = getLocalIPs();
        ips.forEach(ip => console.log(`  ${protocol}://${ip}:${args.port}`));
    }
    console.log('');
    console.log('Watching for changes...');
    console.log('');
    console.log('Press Ctrl+C to stop.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
