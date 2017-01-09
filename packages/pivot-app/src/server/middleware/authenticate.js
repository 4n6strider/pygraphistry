import passport from 'passport';
import { BasicStrategy } from 'passport-http';
import { compare } from 'bcrypt';
import conf from '../config.js';

import { createLogger } from '../../shared/logger.js';
const log = createLogger(__filename);

// The userId to use for all users, until we get a more sophisticated account system
const defaultUserId = 0;


export function authenticateMiddleware() {
    if(!conf.get('authentication.passwordHash')) {
        log.warn(`Authentication disabled because "authentication.passwordHash" is not set in your config. Anybody will be able to access this service without restriction.`);

        return noAuthMiddleware;
    } else {
        passport.use(new BasicStrategy(checkLoginCredentials));
        return passport.authenticate('basic', { session: false });
    }
}


// Called by the Passport strategy to check if a given username+password is valid
function checkLoginCredentials(providedUsername, providedPassword, authResultsCb) {
    const authorizedUsername = conf.get('authentication.username');
    const authorizedPassword = conf.get('authentication.passwordHash');

    compare(providedPassword, authorizedPassword,
        (bcryptErr, isPasswordEqualToHash) => {
            if(bcryptErr) {
                log.error({err: bcryptErr}, `Error while comparing plaintext password (in authentication request for username "${providedUsername}") to the configured hashed password (in config entry 'authentication.passwordHash')`);
                return authResultsCb(bcryptErr, null);
            }

            if(providedUsername !== authorizedUsername) {
                // Invalid username; reject authentication attempt
                log.warn(`Rejecting authentication attempt: invalid username "${providedUsername}"`);
                return authResultsCb(null, false);
            } else if(!isPasswordEqualToHash) {
                // invalid password; reject authentication attempt
                log.warn(`Rejecting authentication attempt: invalid password for username "${providedUsername}"`);
                return authResultsCb(null, false);
            } else {
                // Only if the username and password are valid, call passport's
                // callback, passing (truthy) user info as the second arg
                log.debug(`Successfully authenticated credentials for username "${providedUsername}"`);
                return authResultsCb(null, {
                    username: providedUsername,
                    userId: defaultUserId
                });
            }
        }
    );
}


// Middleware that allows all requests, setting the `req.user` field to default values
function noAuthMiddleware(req, res, next) {
    req.user = {
        username: conf.get('authentication.username'),
        userId: defaultUserId
    };
    return next();
}
