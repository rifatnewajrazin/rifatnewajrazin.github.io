// Step 1 of the Decap CMS GitHub OAuth handshake: redirect the admin's
// login popup to GitHub's authorize screen. Requires OAUTH_CLIENT_ID to be
// set as a Vercel environment variable (see redesign/admin/README.md).
module.exports = (req, res) => {
  const clientId = process.env.OAUTH_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('OAUTH_CLIENT_ID is not configured on the server.');
    return;
  }
  const redirectUri = `https://${req.headers.host}/api/callback`;
  const scope = 'repo,user';
  const url =
    'https://github.com/login/oauth/authorize' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=' + encodeURIComponent(scope);
  res.writeHead(302, { Location: url });
  res.end();
};
