// CloudFront viewer-request function.
// With an S3 REST origin behind Origin Access Control, S3 does not serve
// directory "index documents" — only the distribution's defaultRootObject
// covers "/". This rewrites directory-style URIs so that, e.g.:
//   /app/   -> /app/index.html
//   /app    -> /app/index.html
// while leaving real files (anything containing a ".") untouched.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  }

  return request;
}
