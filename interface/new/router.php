<?php
/**
 * PHP Built-in Server Router for OpenEMR Development
 *
 * Runs PHP from the project root so oauth2/authorize.php works correctly
 * with relative paths and Apache rewrite expectations.
 *
 * Usage:
 *   php -S localhost:8082 interface/new/router.php
 *
 * The -t flag is NOT used because this router handles all requests.
 */

$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// 1. Built SPA assets in public/dist/ — serve directly
$distFile = __DIR__ . '/../../public/dist' . $path;
if (str_starts_with($path, '/app/') && $path !== '/app/') {
    $assetFile = __DIR__ . '/../../public/dist' . $path;
    if (file_exists($assetFile) && is_file($assetFile)) {
        return false; // Let PHP serve it
    }
}

// 2. SPA root — serve index.html
if ($path === '/app/' || $path === '/app') {
    $spaFile = __DIR__ . '/../../public/dist/index.html';
    if (file_exists($spaFile)) {
        require $spaFile;
        return true;
    }
    http_response_code(404);
    echo json_encode(['error' => 'SPA not built. Run `npm run build` in interface/new/.']);
    return true;
}

// 3. Static files — serve directly from project root
// $path already includes /public/ prefix so use project root as base
$staticFile = __DIR__ . '/../..' . $path;
if (file_exists($staticFile) && is_file($staticFile)) {
    return false;
}

// 4. OAuth2 requests — let authorize.php handle (Apache .htaccess compatible)
if (str_starts_with($path, '/oauth2/') && !str_contains($path, 'authorize.php')) {
    $rewritePath = ltrim(substr($path, strlen('/oauth2')), '/');
    $authFile = __DIR__ . '/../../oauth2/authorize.php';
    if (file_exists($authFile)) {
        $_GET['_REWRITE_COMMAND'] = $rewritePath;
        // Must match Symfony's base path detection:
        //   basename(SCRIPT_NAME) === basename(SCRIPT_FILENAME)
        //   → getBaseUrl() = SCRIPT_NAME
        //   → getBasePath() = dirname(SCRIPT_NAME) = /oauth2
        //   → OAuth2 listener triggers on str_ends_with('/oauth2', '/oauth2')
        $_SERVER['SCRIPT_NAME'] = '/oauth2/authorize.php';
        $_SERVER['SCRIPT_FILENAME'] = $authFile;
        $_SERVER['PHP_SELF'] = '/oauth2/authorize.php/' . $rewritePath;
        chdir(__DIR__ . '/../../oauth2');
        require $authFile;
        return true;
    }
}

// 5. Legacy interface files — serve directly from project root
$legacyFile = __DIR__ . '/../..' . $path;
if (file_exists($legacyFile) && is_file($legacyFile)) {
    return false;
}

// 6. Fall back to OpenEMR front controller (public/index.php)
$frontController = __DIR__ . '/../../public/index.php';
if (file_exists($frontController)) {
    chdir(__DIR__ . '/../..');
    require $frontController;
    return true;
}

return false;
