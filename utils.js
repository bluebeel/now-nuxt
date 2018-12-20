const rename = require('@now/build-utils/fs/rename.js');

/** @typedef { import('@now/build-utils/file-ref') } FileRef */
/** @typedef { import('@now/build-utils/file-fs-ref') } FileFsRef */
/** @typedef {{[filePath: string]: FileRef|FileFsRef}} Files */

/**
 * Validate if the entrypoint is allowed to be used
 * @param {string} entrypoint
 * @throws {Error}
 */
function validateEntrypoint(entrypoint) {
    if (
        !/package\.json$/.exec(entrypoint) &&
        !/nuxt\.config\.js$/.exec(entrypoint)
    ) {
        throw new Error(
            'Specified "src" for "@now/nuxt" has to be "package.json" or "nuxt.config.js"',
        );
    }
}

/**
 * This callback type is called `requestCallback` and is displayed as a global symbol.
 *
 * @callback matcher
 * @param {string} filePath
 * @returns {boolean}
 */

/**
 * Exclude certain files from the files object
 * @param {Files} files
 * @param {matcher} matcher
 * @returns {Files}
 */
function excludeFiles(files, matcher) {
    return Object.keys(files).reduce((newFiles, filePath) => {
        if (matcher(filePath)) {
            return newFiles;
        }
        return {
            ...newFiles,
            [filePath]: files[filePath],
        };
    }, {});
}

/**
 * Creates a new Files object holding only the entrypoint files
 * @param {Files} files
 * @param {string} entryDirectory
 * @returns {Files}
 */
function includeOnlyEntryDirectory(files, entryDirectory) {
    if (entryDirectory === '.') {
        return files;
    }

    function matcher(filePath) {
        return !filePath.startsWith(entryDirectory);
    }

    return excludeFiles(files, matcher);
}

/**
 * Moves all files under the entry directory to the root directory
 * @param {Files} files
 * @param {string} entryDirectory
 * @returns {Files}
 */
function moveEntryDirectoryToRoot(files, entryDirectory) {
    if (entryDirectory === '.') {
        return files;
    }

    function delegate(filePath) {
        return filePath.replace(new RegExp(`^${entryDirectory}/`), '');
    }

    return rename(files, delegate);
}

/**
 * Exclude package manager lockfiles from files
 * @param {Files} files
 * @returns {Files}
 */
function excludeLockFiles(files) {
    const newFiles = files;
    if (newFiles['package-lock.json']) {
        delete newFiles['package-lock.json'];
    }
    if (newFiles['yarn.lock']) {
        delete newFiles['yarn.lock'];
    }
    return files;
}

/**
 * Enforce specific package.json configuration for smallest possible lambda
 * @param {{dependencies?: any, devDependencies?: any, scripts?: any}} defaultPackageJson
 */
function normalizePackageJson(defaultPackageJson = {}) {

    return {
        ...defaultPackageJson,
        scripts: {
            ...defaultPackageJson.scripts,
            'now-build': 'nuxt build --no-generate',
        },
    };
}

module.exports = {
    excludeFiles,
    validateEntrypoint,
    includeOnlyEntryDirectory,
    moveEntryDirectoryToRoot,
    excludeLockFiles,
    normalizePackageJson
};