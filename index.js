const {
    createLambda
} = require('@now/build-utils/lambda.js');
const download = require('@now/build-utils/fs/download.js');
const FileFsRef = require('@now/build-utils/file-fs-ref.js');
const FileBlob = require('@now/build-utils/file-blob');
const path = require('path');
const {
    readFile,
    writeFile,
    unlink
} = require('fs.promised');
const {
    runNpmInstall,
    runPackageJsonScript,
} = require('@now/build-utils/fs/run-user-scripts.js');
const glob = require('@now/build-utils/fs/glob.js');
const {
    excludeFiles,
    validateEntrypoint,
    includeOnlyEntryDirectory,
    moveEntryDirectoryToRoot,
    excludeLockFiles,
    normalizePackageJson
} = require('./utils');

/** @typedef { import('@now/build-utils/file-ref').Files } Files */
/** @typedef { import('@now/build-utils/fs/download').DownloadedFiles } DownloadedFiles */

/**
 * @typedef {Object} BuildParamsType
 * @property {Files} files - Files object
 * @property {string} entrypoint - Entrypoint specified for the builder
 * @property {string} workPath - Working directory for this build
 */

/**
 * Read package.json from files
 * @param {DownloadedFiles} files
 */
async function readPackageJson(files) {
    if (!files['package.json']) {
        return {};
    }

    const packageJsonPath = files['package.json'].fsPath;
    return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

/**
 * Write package.json
 * @param {string} workPath
 * @param {Object} packageJson
 */
async function writePackageJson(workPath, packageJson) {
    await writeFile(
        path.join(workPath, 'package.json'),
        JSON.stringify(packageJson, null, 2),
    );
}

/**
 * Write .npmrc with npm auth token
 * @param {string} workPath
 * @param {string} token
 */
async function writeNpmRc(workPath, token) {
    await writeFile(
        path.join(workPath, '.npmrc'),
        `//registry.npmjs.org/:_authToken=${token}`,
    );
}

exports.config = {
    maxLambdaSize: '50mb',
};

/**
 * @param {BuildParamsType} buildParams
 * @returns {Promise<Files>}
 */
exports.build = async ({
    files,
    workPath,
    entrypoint
}) => {
    console.log('entrypoint ', entrypoint);
    validateEntrypoint(entrypoint);

    console.log('downloading user files...');
    const entryDirectory = path.dirname(entrypoint);
    const filesOnlyEntryDirectory = includeOnlyEntryDirectory(
        files,
        entryDirectory,
    );
    const filesWithEntryDirectoryRoot = moveEntryDirectoryToRoot(
        filesOnlyEntryDirectory,
        entryDirectory,
    );
    const filesWithoutLockfiles = excludeLockFiles(filesWithEntryDirectoryRoot);
    const downloadedFiles = await download(filesWithoutLockfiles, workPath);

    console.log('normalizing package.json');
    const packageJson = normalizePackageJson(
        await readPackageJson(downloadedFiles),
    );
    console.log('normalized package.json result: ', packageJson);
    await writePackageJson(workPath, packageJson);

    if (process.env.NPM_AUTH_TOKEN) {
        console.log('found NPM_AUTH_TOKEN in environment, creating .npmrc');
        await writeNpmRc(workPath, process.env.NPM_AUTH_TOKEN);
    }

    console.log('running npm install...');
    await runNpmInstall(workPath, ['--prefer-offline']);
    console.log('running user script...');
    await runPackageJsonScript(workPath, 'now-build');
    console.log('running npm install --production...');
    await runNpmInstall(workPath, ['--prefer-offline', '--production']);
    if (process.env.NPM_AUTH_TOKEN) {
        await unlink(path.join(workPath, '.npmrc'));
    }

    const filesAfterBuild = await glob('**', workPath);

    console.log('preparing lambda files...');
    const dotNuxtServerRootFiles = await glob('.nuxt/dist/*', workPath);
    const nodeModules = excludeFiles(
        await glob('node_modules/**', workPath),
        file => file.startsWith('node_modules/.cache'),
    );
    const launcherFiles = {
        'now__bridge.js': new FileFsRef({
            fsPath: require('@now/node-bridge')
        }),
    };
    const nuxtFiles = {
        ...nodeModules,
        ...dotNuxtServerRootFiles,
        ...launcherFiles,
    };
    if (filesAfterBuild['nuxt.config.js']) {
        nuxtFiles['nuxt.config.js'] = filesAfterBuild['nuxt.config.js'];
    }
    const pages = await glob(
        '**/*.js',
        path.join(workPath, '.nuxt', 'dist', 'client', 'pages'),
    );
    const launcherPath = path.join(__dirname, 'launcher.js');
    const launcherData = await readFile(launcherPath, 'utf8');

    const lambdas = {};
    await Promise.all(
        Object.keys(pages).map(async (page) => {

            const pathname = page.replace(/\.js$/, '');

            const pageFiles = {
                [`.nuxt/dist/client/app.js`]: filesAfterBuild[
                    `.nuxt/dist/client/app.js`
                ],
                [`.nuxt/dist/client/commons.app.js`]: filesAfterBuild[
                    `.nuxt/dist/client/commons.app.js`
                ],
                [`.nuxt/dist/client/runtime.js`]: filesAfterBuild[
                    `.nuxt/dist/client/runtime.js`
                ],
                [`.nuxt/dist/client/pages/${page}`]: filesAfterBuild[
                    `.nuxt/dist/client/pages/${page}`
                ],
                [`.nuxt/dist/server/index.spa.html`]: filesAfterBuild[
                    `.nuxt/dist/server/index.spa.html`
                ],
                [`.nuxt/dist/server/index.ssr.html`]: filesAfterBuild[
                    `.nuxt/dist/server/index.spa.html`
                ],
                [`.nuxt/dist/server/vue-ssr-client-manifest.json`]: filesAfterBuild[
                    `.nuxt/dist/server/vue-ssr-client-manifest.json`
                ],
                [`.nuxt/dist/server/server-bundle.json`]: filesAfterBuild[
                    `.nuxt/dist/server/server-bundle.json`
                ],
            };

            console.log(`Creating lambda for page: "${page}"...`);
            lambdas[path.join(entryDirectory, pathname)] = await createLambda({
                files: {
                    ...nuxtFiles,
                    ...pageFiles,
                    'now__launcher.js': new FileBlob({
                        data: launcherData
                    }),
                },
                handler: 'now__launcher.launcher',
                runtime: 'nodejs8.10',
            });
            console.log(`Created lambda for page: "${page}"`);
        }),
    );

    return { ...lambdas };
};

exports.prepareCache = async ({
    files,
    entrypoint,
    cachePath,
    workPath,
}) => {
    console.log('downloading user files...');
    const entryDirectory = path.dirname(entrypoint);
    const filesOnlyEntryDirectory = includeOnlyEntryDirectory(
        files,
        entryDirectory,
    );
    const filesWithEntryDirectoryRoot = moveEntryDirectoryToRoot(
        filesOnlyEntryDirectory,
        entryDirectory,
    );
    const filesWithoutLockfiles = excludeLockFiles(filesWithEntryDirectoryRoot);
    await download(filesWithoutLockfiles, workPath);
    await download(await glob('.nuxt/**', workPath), cachePath);
    await download(await glob('node_modules/**', workPath), cachePath);

    console.log('.nuxt folder contents', await glob('.nuxt/**', cachePath));
    console.log(
        '.cache folder contents',
        await glob('node_modules/.cache/**', cachePath),
    );

    console.log('running npm install...');
    await runNpmInstall(cachePath);

    return {
        ...(await glob('.nuxt/server/index.spa.html', cachePath)),
        ...(await glob('.nuxt/server/index.ssr.html', cachePath)),
        ...(await glob('.nuxt/server/vue-ssr-client-manifest.json', cachePath)),
        ...(await glob('.next/server/server-bundle.json', cachePath)),
        ...(await glob('node_modules/**', cachePath)),
        ...(await glob('yarn.lock', cachePath)),
    };
};