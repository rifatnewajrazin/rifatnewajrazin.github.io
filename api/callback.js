// Step 2 of the Decap CMS GitHub OAuth handshake: GitHub redirects here
// with a one-time code, which is exchanged (server-side, using the secret)
// for an access token, then handed to the admin popup via postMessage —
// the standard protocol Decap/Netlify CMS's github backend expects.
module.exports = async (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const code = req.query && req.query.code;

  if (!clientId || !clientSecret) {
    res.status(500).send(renderScript('error', { error: 'server_error', error_description: 'OAuth env vars are not configured.' }));
    return;
  }
  if (!code) {
    res.status(400).send(renderScript('error', { error: 'invalid_request', error_description: 'Missing code.' }));
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      res.status(400).send(renderScript('error', tokenData));
      return;
    }

    res.status(200).send(renderScript('success', { token: tokenData.access_token, provider: 'github' }));
  } catch (err) {
    res.status(500).send(renderScript('error', { error: 'server_error', error_description: String(err) }));
  }
};

function renderScript(status, payload) {
  const message = 'authorization:github:' + status + ':' + JSON.stringify(payload);
  return (
    '<!doctype html><html><body><script>' +
    '(function() {' +
    'function receiveMessage(e) {' +
    'window.opener.postMessage(' + JSON.stringify(message) + ', e.origin);' +
    'window.removeEventListener("message", receiveMessage, false);' +
    '}' +
    'window.addEventListener("message", receiveMessage, false);' +
    'window.opener.postMessage("authorizing:github", "*");' +
    '})();' +
    '</script></body></html>'
  );
}
