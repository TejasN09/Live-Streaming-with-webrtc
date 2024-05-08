var urlParams = new URLSearchParams(window.location.search);
let roomName = urlParams.get('roomId');

var ws = new WebSocket('wss://' + location.host + '/one2many?roomId=' + roomName );
var video;
var webRtcPeer;

window.onload = function() {
	console = new Console();
	video = document.getElementById('video');

	document.getElementById('viewer').addEventListener('click', function() { viewer(); } );
	document.getElementById('call').addEventListener('click', function() { presenter(); } );
	document.getElementById('terminate').addEventListener('click', function() { stop(); } );
}

window.onbeforeunload = function() {
	ws.close();
}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
	case 'presenterResponse':
		presenterResponse(parsedMessage);
		break;
	case 'viewerResponse':
		viewerResponse(parsedMessage);
		break;
	case 'stopCommunication':
		dispose();
		break;
	case 'iceCandidate':
		webRtcPeer.addIceCandidate(parsedMessage.candidate)
		break;
	default:
		console.error('Unrecognized message', parsedMessage);
	}
}

function presenterResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function viewerResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknow error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function captureAudio() {
    return navigator.mediaDevices.getUserMedia({
        audio: true  
    });
}

function presenter() {
    if (!webRtcPeer) {
        showSpinner(video);

        Promise.all([captureScreen(), captureAudio()]).then(function(streams) {
            var screenStream = streams[0];
            var audioStream = streams[1];

            // Assuming the browser supports adding tracks
            audioStream.getAudioTracks().forEach(function(track) {
                screenStream.addTrack(track);
            });

            var options = {
                localVideo: video,
                videoStream: screenStream,
                onicecandidate: onIceCandidate,
                mediaConstraints: {
                    audio: false,
                    video: false
                }
            };

            webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(error) {
                if (error) {
                    return error;
                }
                this.generateOffer(onOfferPresenter);
            });
        }).catch(function(error) {
            console.error('Error accessing media devices: ', error);
        });
    }
}

function captureScreen() {
    return navigator.mediaDevices.getDisplayMedia({
        video: true,
		audio: true
    });
}


function presenter_v1() {
    if (!webRtcPeer) {
        showSpinner(video);

        captureScreen().then(function(stream) {
            var videoTracks = stream.getVideoTracks();
            if (videoTracks.length > 0) {
                console.log('Using video device: ' + videoTracks[0].label);
            }

            var options = {
                localVideo: video,
                videoStream: stream, // Ensure the stream is being used
                onicecandidate: onIceCandidate,
                mediaConstraints: {  // Make sure to not request local camera
                    audio: false,
                    video: false
                }
            };

            webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(error) {
                if (error) {
                    return onError(error);
                }
                this.generateOffer(onOfferPresenter);
            });
        }).catch(function(error) {
            console.error('Error accessing media devices: ', error);
        });
    }
}


function onOfferPresenter(error, offerSdp) {
    if (error) return onError(error);

	var message = {
		id : 'presenter',
		sdpOffer : offerSdp,
		roomId : roomName
	};
	sendMessage(message);
}

function viewer() {
	if (!webRtcPeer) {
		showSpinner(video);

		var options = {
			remoteVideo: video,
			onicecandidate : onIceCandidate,
			roomId: roomName 
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
			if(error) return onError(error);

			this.generateOffer(onOfferViewer);
		});
	}
}

function onError(error){
	console.error(error);
}

function onOfferViewer(error, offerSdp) {
	if (error) return onError(error)

	var message = {
		id : 'viewer',
		sdpOffer : offerSdp,
		roomId : roomName
	}
	sendMessage(message);
}

function onIceCandidate(candidate) {
	   console.log('Local candidate' + JSON.stringify(candidate));

	   var message = {
	      id : 'onIceCandidate',
	      candidate : candidate,
		  roomId : roomName
	   }
	   sendMessage(message);
}

function stop() {
	if (webRtcPeer) {
		var message = {
				id : 'stop'
		}
		sendMessage(message);
		dispose();
	}
}

function dispose() {
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;
	}
	hideSpinner(video);
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
