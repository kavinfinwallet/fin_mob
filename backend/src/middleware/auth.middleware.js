const { verifyAccessToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'Authorization header missing or malformed', 401);
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return errorResponse(res, 'Access token expired. Please refresh.', 401);
      }
      return errorResponse(res, 'Invalid access token', 401);
    }

    req.customer = decoded;
    next();
  } catch (err) {
    console.error('[authMiddleware]', err);
    return errorResponse(res, 'Authentication error', 500);
  }
};

module.exports = authMiddleware;
