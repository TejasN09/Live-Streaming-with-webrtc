var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

var options = {
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
 * Definition of global variables.
 */
var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;
var rooms = {};
var noPresenterMessage = 'No active presenter. Try again later...';

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function () {
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server: server,
    path: '/one2many'
});

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}

wss.on('connection', function (ws) {
    var sessionId = nextUniqueId();
    console.log('Connection received with sessionId ' + sessionId);

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function (_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'presenter':
                startPresenter(message.roomId, sessionId, ws, message.sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'presenterResponse',
                            response: 'rejected',
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'presenterResponse',
                        response: 'accepted',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'viewer':
                startViewer(message.roomId, sessionId, ws, message.sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'rejected',
                            message: error
                        }));
                    }

                    ws.send(JSON.stringify({
                        id: 'viewerResponse',
                        response: 'accepted',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'stop':
                stop(message.roomId, sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(message.roomId, sessionId, message.candidate);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }
    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function startPresenter(roomId, sessionId, ws, sdpOffer, callback) {
    clearCandidatesQueue(sessionId);

    if (!rooms[roomId]) {
        rooms[roomId] = {
            presenter: null,
            viewers: []
        };
    }

    const room = rooms[roomId];

    if (room.presenter !== null) {
        stop(roomId, sessionId);
        return callback("Another user is currently acting as presenter. Try again later ...");
    }

    room.presenter = {
        id: sessionId,
        pipeline: null,
        webRtcEndpoint: null
    };

    getKurentoClient(function (error, kurentoClient) {
        if (error) {
            stop(roomId, sessionId);
            return callback(error);
        }

        if (room.presenter === null) {
            stop(roomId, sessionId);
            return callback(noPresenterMessage);
        }

        kurentoClient.create('MediaPipeline', function (error, pipeline) {
            if (error) {
                stop(roomId, sessionId);
                return callback(error);
            }

            if (room.presenter === null) {
                stop(roomId, sessionId);
                return callback(noPresenterMessage);
            }

            room.presenter.pipeline = pipeline;
            pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {
                if (error) {
                    stop(roomId, sessionId);
                    return callback(error);
                }

                if (room.presenter === null) {
                    stop(roomId, sessionId);
                    return callback(noPresenterMessage);
                }

                room.presenter.webRtcEndpoint = webRtcEndpoint;

                if (candidatesQueue[sessionId]) {
                    while (candidatesQueue[sessionId].length) {
                        var candidate = candidatesQueue[sessionId].shift();
                        webRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                webRtcEndpoint.on('IceCandidateFound', function (event) {
                    var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    ws.send(JSON.stringify({
                        id: 'iceCandidate',
                        candidate: candidate
                    }));
                });

                webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        stop(roomId, sessionId);
                        return callback(error);
                    }

                    if (room.presenter === null) {
                        stop(roomId, sessionId);
                        return callback(noPresenterMessage);
                    }

                    callback(null, sdpAnswer);
                });

                webRtcEndpoint.gatherCandidates(function (error) {
                    if (error) {
                        stop(roomId, sessionId);
                        return callback(error);
                    }
                });
            });
        });
    });
}

function startViewer(roomId, sessionId, ws, sdpOffer, callback) {
    clearCandidatesQueue(sessionId);

    if (!rooms[roomId] || !rooms[roomId].presenter) {
        stop(roomId, sessionId);
        return callback(noPresenterMessage);
    }

    const room = rooms[roomId];

    room.presenter.pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {
        if (error) {
            stop(roomId, sessionId);
            return callback(error);
        }
        const viewer = {
            id: sessionId,
            webRtcEndpoint: webRtcEndpoint,
            ws: ws
        };
        room.viewers.push(viewer);

        if (!room.presenter) {
            stop(roomId, sessionId);
            return callback(noPresenterMessage);
        }

        if (candidatesQueue[sessionId]) {
            while (candidatesQueue[sessionId].length) {
                var candidate = candidatesQueue[sessionId].shift();
                webRtcEndpoint.addIceCandidate(candidate);
            }
        }

        webRtcEndpoint.on('IceCandidateFound', function (event) {
            var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: candidate
            }));
        });

        webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
            if (error) {
                stop(roomId, sessionId);
                return callback(error);
            }
            if (!room.presenter) {
                stop(roomId, sessionId);
                return callback(noPresenterMessage);
            }

            room.presenter.webRtcEndpoint.connect(webRtcEndpoint, function (error) {
                if (error) {
                    stop(roomId, sessionId);
                    return callback(error);
                }
                if (!room.presenter) {
                    stop(roomId, sessionId);
                    return callback(noPresenterMessage);
                }

                callback(null, sdpAnswer);
                webRtcEndpoint.gatherCandidates(function (error) {
                    if (error) {
                        stop(roomId, sessionId);
                        return callback(error);
                    }
                });
            });
        });
    });
}
function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId]) {
        delete candidatesQueue[sessionId];
    }
}
function stop(roomId, sessionId) {
    const room = rooms[roomId];
    if (!room) {
        // Room doesn't exist, do nothing
        return;
    }

    if (room.presenter && room.presenter.id === sessionId) {
        // Stop presenter
        for (const viewer of room.viewers) {
            if (viewer.ws) {
                viewer.ws.send(JSON.stringify({
                    id: 'stopCommunication'
                }));
            }
        }
        room.presenter.pipeline.release();
        delete rooms[roomId];
    } else {
        // Stop viewer
        const viewerIndex = room.viewers.findIndex(v => v.id === sessionId);
        if (viewerIndex !== -1) {
            room.viewers[viewerIndex].webRtcEndpoint.release();
            room.viewers.splice(viewerIndex, 1);
        }
    }

    clearCandidatesQueue(sessionId);

    if (Object.keys(rooms).length === 0 && !kurentoClient) {
        console.log('Closing kurento client');
        kurentoClient.close();
        kurentoClient = null;
    }
}
function onIceCandidate(roomId, sessionId, _candidate) {
    const candidate = kurento.getComplexType('IceCandidate')(_candidate);
    const room = rooms[roomId];
    if (!room) {
        // Room doesn't exist, do nothing
        return;
    }

    if (room.presenter && room.presenter.id === sessionId && room.presenter.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        room.presenter.webRtcEndpoint.addIceCandidate(candidate);
    } else {
        const viewer = room.viewers.find(v => v.id === sessionId);
        if (viewer && viewer.webRtcEndpoint) {
            console.info('Sending viewer candidate');
            viewer.webRtcEndpoint.addIceCandidate(candidate);
        } else {
            console.info('Queueing candidate');
            if (!candidatesQueue[sessionId]) {
                candidatesQueue[sessionId] = [];
            }
            candidatesQueue[sessionId].push(candidate);
        }
    }
}
app.use(express.static(path.join(__dirname, 'static')));
app.get('/role', function (req, res) {
    var userType = req.query.userType;
    var roomId = req.query.roomId;
    if (userType === 'host') {
        res.sendFile(path.join(__dirname, 'static/index.html'));
    } else if (userType === 'viewer') {
        res.sendFile(path.join(__dirname, 'static/viewer.html'));
    } else {
        res.status(400).send('Invalid userType');
    }
});
