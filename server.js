var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs    = require('fs');
var https = require('https');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

var options =
{
  key:  fs.readFileSync('keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
 * Definition of global variables.
 */
var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;
var presenter = null;
var viewers = [];
var noPresenterMessage = 'No active presenter. Try again later...';

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server : server,
    path : '/one2many'
});

function nextUniqueId() {
	idCounter++;
	return idCounter.toString();
}


wss.on('connection', function(ws) {

	var sessionId = nextUniqueId();
	console.log('Connection received with sessionId ' + sessionId);

    ws.on('error', function(error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function() {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        // console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
        case 'presenter':
			startPresenter(message.roomId,sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
				if (error) {
					return ws.send(JSON.stringify({
						id : 'presenterResponse',
						response : 'rejected',
						message : error
					}));
				}
				ws.send(JSON.stringify({
					id : 'presenterResponse',
					response : 'accepted',
					sdpAnswer : sdpAnswer
				}));
			});
			break;

        case 'viewer':
			startViewer(message.roomId,sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
				if (error) {
					return ws.send(JSON.stringify({
						id : 'viewerResponse',
						response : 'rejected',
						message : error
					}));
				}

				ws.send(JSON.stringify({
					id : 'viewerResponse',
					response : 'accepted',
					sdpAnswer : sdpAnswer
				}));
			});
			break;

        case 'stop':
            stop(sessionId);
            break;

        case 'onIceCandidate':
            onIceCandidate(sessionId, message.candidate);
            break;

        default:
            ws.send(JSON.stringify({
                id : 'error',
                message : 'Invalid message ' + message
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

    kurento(argv.ws_uri, function(error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                    + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

var pipelines = {}; 


// function startPresenter(roomId,sessionId, ws, sdpOffer, callback) {
// 	clearCandidatesQueue(sessionId);

// 	// if (presenter !== null) {
// 	// 	stop(sessionId);
// 	// 	return callback("Another user is currently acting as presenter. Try again later ...");
// 	// }

// 	presenter = {
// 		id : sessionId,
// 		pipeline : null,
// 		webRtcEndpoint : null
// 	}

// 	getKurentoClient(function(error, kurentoClient) {
// 		if (error) {
// 			stop(sessionId);
// 			return callback(error);
// 		}

// 		if (presenter === null) {
// 			stop(sessionId);
// 			return callback(noPresenterMessage);
// 		}

// 		kurentoClient.create('MediaPipeline', function(error, pipeline) {
// 			if (error) {
// 				stop(sessionId);
// 				return callback(error);
// 			}

// 			if (presenter === null) {
// 				stop(sessionId);
// 				return callback(noPresenterMessage);
// 			}

// 			presenter.pipeline = pipeline;
// 			pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
// 				if (error) {
// 					stop(sessionId);
// 					return callback(error);
// 				}

// 				if (presenter === null) {
// 					stop(sessionId);
// 					return callback(noPresenterMessage);
// 				}

// 				presenter.webRtcEndpoint = webRtcEndpoint;

//                 if (candidatesQueue[sessionId]) {
//                     while(candidatesQueue[sessionId].length) {
//                         var candidate = candidatesQueue[sessionId].shift();
//                         webRtcEndpoint.addIceCandidate(candidate);
//                     }
//                 }

//                 webRtcEndpoint.on('IceCandidateFound', function(event) {
//                     var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
//                     ws.send(JSON.stringify({
//                         id : 'iceCandidate',
//                         candidate : candidate
//                     }));
//                 });

// 				webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
// 					if (error) {
// 						stop(sessionId);
// 						return callback(error);
// 					}

// 					if (presenter === null) {
// 						stop(sessionId);
// 						return callback(noPresenterMessage);
// 					}

// 					callback(null, sdpAnswer);
// 				});

//                 webRtcEndpoint.gatherCandidates(function(error) {
//                     if (error) {
//                         stop(sessionId);
//                         return callback(error);
//                     }
//                 });
//             });
//         });
// 	});
// }

// function startViewer(roomId,sessionId, ws, sdpOffer, callback) {
// 	clearCandidatesQueue(sessionId);

// 	if (presenter === null) {
// 		stop(sessionId);
// 		return callback(noPresenterMessage);
// 	}

// 	presenter.pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
// 		if (error) {
// 			stop(sessionId);
// 			return callback(error);
// 		}
// 		viewers[sessionId] = {
// 			"webRtcEndpoint" : webRtcEndpoint,
// 			"ws" : ws
// 		}

// 		if (presenter === null) {
// 			stop(sessionId);
// 			return callback(noPresenterMessage);
// 		}

// 		if (candidatesQueue[sessionId]) {
// 			while(candidatesQueue[sessionId].length) {
// 				var candidate = candidatesQueue[sessionId].shift();
// 				webRtcEndpoint.addIceCandidate(candidate);
// 			}
// 		}

//         webRtcEndpoint.on('IceCandidateFound', function(event) {
//             var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
//             ws.send(JSON.stringify({
//                 id : 'iceCandidate',
//                 candidate : candidate
//             }));
//         });

// 		webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
// 			if (error) {
// 				stop(sessionId);
// 				return callback(error);
// 			}
// 			if (presenter === null) {
// 				stop(sessionId);
// 				return callback(noPresenterMessage);
// 			}

// 			presenter.webRtcEndpoint.connect(webRtcEndpoint, function(error) {
// 				if (error) {
// 					stop(sessionId);
// 					return callback(error);
// 				}
// 				if (presenter === null) {
// 					stop(sessionId);
// 					return callback(noPresenterMessage);
// 				}

// 				callback(null, sdpAnswer);
// 		        webRtcEndpoint.gatherCandidates(function(error) {
// 		            if (error) {
// 			            stop(sessionId);
// 			            return callback(error);
// 		            }
// 		        });
// 		    });
// 	    });
// 	});
// }

var pipelines = {}; 

function startPresenter(roomId, sessionId, ws, sdpOffer, callback) {
    clearCandidatesQueue(sessionId);

    // Check if pipeline for this roomId already exists
    if (!pipelines[roomId]) {
        pipelines[roomId] = {
            pipeline: null,
            presenter: null
        };
    }

    var pipelineObj = pipelines[roomId];

    if (pipelineObj.presenter !== null) {
        stop(sessionId);
        return callback("Another user is currently acting as presenter for this room. Try again later ...");
    }

    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            stop(sessionId);
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if (error) {
                stop(sessionId);
                return callback(error);
            }

            pipelineObj.pipeline = pipeline;

            pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
                if (error) {
                    stop(sessionId);
                    return callback(error);
                }

                pipelineObj.presenter = {
                    id: sessionId,
                    webRtcEndpoint: webRtcEndpoint
                };

                webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                    if (error) {
                        stop(sessionId);
                        return callback(error);
                    }

                    callback(null, sdpAnswer);
                });

                webRtcEndpoint.gatherCandidates(function(error) {
                    if (error) {
                        stop(sessionId);
                        return callback(error);
                    }
                });
            });
        });
    });
}

function startViewer(roomId, sessionId, ws, sdpOffer, callback) {
    clearCandidatesQueue(sessionId);

    // Check if pipeline for this roomId exists
    var pipelineObj = pipelines[roomId];

    if (!pipelineObj || !pipelineObj.pipeline || !pipelineObj.presenter) {
        stop(sessionId);
        return callback("No active presenter for this room. Try again later ...");
    }

    pipelineObj.pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
        if (error) {
            stop(sessionId);
            return callback(error);
        }

        var viewer = {
            id: sessionId,
            webRtcEndpoint: webRtcEndpoint,
            ws: ws
        };

        if (!viewers[roomId]) {
            viewers[roomId] = [];
        }

        viewers[roomId].push(viewer);

        if (candidatesQueue[sessionId]) {
            while (candidatesQueue[sessionId].length) {
                var candidate = candidatesQueue[sessionId].shift();
                webRtcEndpoint.addIceCandidate(candidate);
            }
        }

        webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
            if (error) {
                stop(sessionId);
                return callback(error);
            }

            pipelineObj.presenter.webRtcEndpoint.connect(webRtcEndpoint, function(error) {
                if (error) {
                    stop(sessionId);
                    return callback(error);
                }

                callback(null, sdpAnswer);

                webRtcEndpoint.gatherCandidates(function(error) {
                    if (error) {
                        stop(sessionId);
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

function stop(sessionId) {
	if (presenter !== null && presenter.id == sessionId) {
		for (var i in viewers) {
			var viewer = viewers[i];
			if (viewer.ws) {
				viewer.ws.send(JSON.stringify({
					id : 'stopCommunication'
				}));
			}
		}
		presenter.pipeline.release();
		presenter = null;
		viewers = [];

	} else if (viewers[sessionId]) {
		viewers[sessionId].webRtcEndpoint.release();
		delete viewers[sessionId];
	}

	clearCandidatesQueue(sessionId);

	if (viewers.length < 1 && !presenter) {
        console.log('Closing kurento client');
        kurentoClient.close();
        kurentoClient = null;
    }
}

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (presenter && presenter.id === sessionId && presenter.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        presenter.webRtcEndpoint.addIceCandidate(candidate);
    }
    else if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
        console.info('Sending viewer candidate');
        viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}



app.use(express.static(path.join(__dirname, 'static')));


app.get('/role', function(req, res) {
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




