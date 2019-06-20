/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import * as express from 'express'
import * as compression from 'compression'
import ServerConfig from './config'
import { ConsoleLogger } from '../../mol-util/console-logger';
import { PerformanceMonitor } from '../../mol-util/performance-monitor';
import { initWebApi } from './server/api-web';
import Version from './version'

function setupShutdown() {
    if (ServerConfig.shutdownParams.timeoutVarianceMinutes > ServerConfig.shutdownParams.timeoutMinutes) {
        ConsoleLogger.log('Server', 'Shutdown timeout variance is greater than the timer itself, ignoring.');
    } else {
        let tVar = 0;
        if (ServerConfig.shutdownParams.timeoutVarianceMinutes > 0) {
            tVar = 2 * (Math.random() - 0.5) * ServerConfig.shutdownParams.timeoutVarianceMinutes;
        }
        let tMs = (ServerConfig.shutdownParams.timeoutMinutes + tVar) * 60 * 1000;

        console.log(`----------------------------------------------------------------------------`);
        console.log(`  The server will shut down in ${PerformanceMonitor.format(tMs)} to prevent slow performance.`);
        console.log(`  Please make sure a daemon is running that will automatically restart it.`);
        console.log(`----------------------------------------------------------------------------`);
        console.log();

        setTimeout(() => {
            /*if (WebApi.ApiState.pendingQueries > 0) {
                WebApi.ApiState.shutdownOnZeroPending = true;
            } else*/ {
                ConsoleLogger.log('Server', `Shut down due to timeout.`);
                process.exit(0);
            }
        }, tMs);
    }
}

const port = process.env.port || ServerConfig.defaultPort;

function startServer() {
    let app = express();
    app.use(compression(<any>{ level: 6, memLevel: 9, chunkSize: 16 * 16384, filter: () => true }));

    // app.get(ServerConfig.appPrefix + '/documentation', (req, res) => {
    //     res.writeHead(200, { 'Content-Type': 'text/html' });
    //     res.write(Documentation.getHTMLDocs(ServerConfig.appPrefix));
    //     res.end();
    // });

    initWebApi(app);

    // app.get('*', (req, res) => {
    //     res.writeHead(200, { 'Content-Type': 'text/html' });
    //     res.write(Documentation.getHTMLDocs(ServerConfig.appPrefix));
    //     res.end();
    // });

    app.listen(port);
}

startServer();
console.log(`Mol* ModelServer ${Version}`);
console.log(``);
console.log(`The server is running on port ${port}.`);
console.log(``);

if (ServerConfig.shutdownParams && ServerConfig.shutdownParams.timeoutMinutes > 0) {
    setupShutdown();
}