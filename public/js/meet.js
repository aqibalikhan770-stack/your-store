(function () {
  'use strict';

  /* ================= ELEMENTS ================= */
  const lobby = document.getElementById('lobby');
  const meeting = document.getElementById('meeting');
  const lobbyName = document.getElementById('lobby-name');
  const lobbyRoom = document.getElementById('lobby-room');
  const btnRandomRoom = document.getElementById('btn-random-room');
  const btnJoin = document.getElementById('lobby-join');
  const stage = document.getElementById('stage');
  const roomCodeEl = document.getElementById('room-code');
  const timerEl = document.getElementById('timer');

  const btnMic = document.getElementById('btn-mic');
  const btnCam = document.getElementById('btn-cam');
  const btnScreen = document.getElementById('btn-screen');
  const btnPeople = document.getElementById('btn-participants');
  const btnChat = document.getElementById('btn-chat');
  const btnInvite = document.getElementById('btn-invite');
  const btnLeave = document.getElementById('btn-leave');

  const sidepanel = document.getElementById('sidepanel');
  const tabParticipants = document.getElementById('tab-participants');
  const tabChat = document.getElementById('tab-chat');
  const panelParticipants = document.getElementById('panel-participants');
  const panelChat = document.getElementById('panel-chat');
  const participantsList = document.getElementById('participants-list');
  const pcountEl = document.getElementById('pcount');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  const toastEl = document.getElementById('toast');
  const modal = document.getElementById('modal');
  const modalBtn = document.getElementById('modal-btn');

  /* ================= STATE ================= */
  const state = {
    socket: null,
    roomId: '',
    name: '',
    myId: null,
    isHost: false,
    users: {},            // id -> { name, isHost }
    peers: {},            // id -> RTCPeerConnection
    remoteStreams: {},    // id -> MediaStream
    remoteStates: {},     // id -> { audioMuted, videoMuted, sharing }
    localStream: null,
    screenStream: null,
    micOn: true,
    camOn: true,
    sharing: false,
    audioLocked: false,
    videoLocked: false,
    kicked: false,
    startTime: 0,
    timerInt: null,
    toastInt: null
  };

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  const MEDIA_CONSTRAINTS = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    },
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      facingMode: 'user'
    }
  };

  /* ================= HELPERS ================= */
  function genRoomCode(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function showScreen(el) {
    lobby.classList.add('hidden');
    meeting.classList.add('hidden');
    el.classList.remove('hidden');
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(state.toastInt);
    state.toastInt = setTimeout(() => toastEl.classList.add('hidden'), 3400);
  }

  function fmtTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function startTimer() {
    state.startTime = Date.now();
    clearInterval(state.timerInt);
    state.timerInt = setInterval(() => {
      const sec = Math.floor((Date.now() - state.startTime) / 1000);
      timerEl.textContent = fmtTime(sec);
    }, 1000);
  }

  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ================= MEDIA ================= */
  async function getMedia() {
    if (state.localStream) return state.localStream;
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      state.localStream.getTracks().forEach((t) => {
        if (t.kind === 'audio') t.enabled = state.micOn;
        if (t.kind === 'video') t.enabled = state.camOn;
      });
      // boost audio/video quality on senders
      for (const id in state.peers) applyQuality(state.peers[id]);
      return state.localStream;
    } catch (err) {
      console.error('getUserMedia error', err);
      state.localStream = null;
      throw err;
    }
  }

  function applyQuality(pc) {
    pc.getSenders().forEach((sender) => {
      if (!sender.track) return;
      try {
        const params = sender.getParameters();
        params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
        params.encodings.forEach((enc) => {
          enc.maxBitrate = sender.track.kind === 'audio' ? 128000 : 2500000;
          if (sender.track.kind === 'video') {
            enc.maxFramerate = 30;
          }
        });
        sender.setParameters(params).catch(() => {});
      } catch (e) { /* ignore */ }
    });
  }

  function setMic(on) {
    state.micOn = on;
    const track = state.localStream && state.localStream.getAudioTracks()[0];
    if (track) track.enabled = on;
    updateControls();
    renderStage();
    renderParticipants();
  }

  function setCam(on) {
    state.camOn = on;
    const track = state.localStream && state.localStream.getVideoTracks()[0];
    if (track) track.enabled = on;
    updateControls();
    renderStage();
    renderParticipants();
  }

  async function toggleMic() {
    if (state.audioLocked) { toast('Host has muted your microphone'); return; }
    if (!state.localStream) {
      try { await getMedia(); addTracksToPeers(); } catch (e) { toast('Microphone is not available'); return; }
    }
    setMic(!state.micOn);
  }

  async function toggleCam() {
    if (!state.localStream) {
      try { await getMedia(); addTracksToPeers(); } catch (e) { toast('Camera is not available'); return; }
    }
    setCam(!state.camOn);
  }

  /* ================= SCREEN SHARE ================= */
  async function toggleScreen() {
    if (state.sharing) { stopScreen(); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      state.screenStream = stream;
      state.sharing = true;
      stream.getVideoTracks()[0].addEventListener('ended', () => stopScreen());
      swapVideoTracks();
      socketEmit('meet:screen-state', { roomId: state.roomId, sharing: true });
      updateControls();
      renderStage();
      toast('You are sharing your screen');
    } catch (err) {
      toast('Screen sharing was cancelled');
    }
  }

  function stopScreen() {
    if (!state.sharing) return;
    state.screenStream && state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
    state.sharing = false;
    swapVideoTracks();
    socketEmit('meet:screen-state', { roomId: state.roomId, sharing: false });
    updateControls();
    renderStage();
  }

  function swapVideoTracks() {
    const videoTrack = state.sharing
      ? state.screenStream.getVideoTracks()[0]
      : (state.localStream ? state.localStream.getVideoTracks()[0] : null);
    for (const id in state.peers) {
      const pc = state.peers[id];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(videoTrack).catch(() => {});
    }
    // update local preview
    const localTile = document.getElementById('video-local');
    if (localTile) {
      if (state.sharing && state.screenStream) {
        localTile.srcObject = state.screenStream;
      } else if (state.localStream) {
        localTile.srcObject = state.localStream;
      } else {
        localTile.srcObject = null;
      }
    }
  }

  /* ================= SOCKET ================= */
  function socketEmit(ev, payload) {
    if (state.socket && state.socket.connected) state.socket.emit(ev, payload);
  }

  function connect() {
    state.socket = io();

    state.socket.on('connect', () => {
      state.socket.emit('meet:join', { roomId: state.roomId, name: state.name }, (res) => {
        state.myId = res.you;
        state.isHost = res.isHost;
        state.roomId = res.roomId;
        state.users = {};
        res.users.forEach((u) => {
          state.users[u.id] = { name: u.name, isHost: u.isHost };
          state.remoteStates[u.id] = { audioMuted: false, videoMuted: false, sharing: false };
        });
        roomCodeEl.textContent = res.roomId;
        history.replaceState(null, '', '/meet/' + res.roomId);
        renderStage();
        renderParticipants();
        if (state.isHost) toast('You are the host of this meeting');
        addTracksToPeers();
      });
    });

    state.socket.on('meet:user-joined', ({ id, name, isHost }) => {
      state.users[id] = { name, isHost };
      state.remoteStates[id] = { audioMuted: false, videoMuted: false, sharing: false };
      createPeer(id, true);
      renderStage();
      renderParticipants();
      toast(name + ' joined the meeting');
      addSysChat(name + ' joined the meeting');
    });

    state.socket.on('meet:signal', ({ from, data }) => handleSignal(from, data));

    state.socket.on('meet:user-left', ({ id, newHostId }) => {
      if (!state.users[id]) return;
      const name = state.users[id].name;
      closePeer(id);
      delete state.users[id];
      delete state.remoteStreams[id];
      delete state.remoteStates[id];
      if (newHostId && state.users[newHostId]) {
        state.users[newHostId].isHost = true;
      }
      if (state.myId === newHostId) {
        state.isHost = true;
        toast('You are now the host');
      }
      renderStage();
      renderParticipants();
      addSysChat(name + ' left the meeting');
    });

    state.socket.on('meet:you-are-host', ({ name }) => {
      state.isHost = true;
      if (state.users[state.myId]) state.users[state.myId].isHost = true;
      toast('You are now the host');
      renderStage();
      renderParticipants();
    });

    state.socket.on('meet:screen-state', ({ id, sharing }) => {
      if (!state.remoteStates[id]) state.remoteStates[id] = { audioMuted: false, videoMuted: false, sharing: false };
      state.remoteStates[id].sharing = sharing;
      renderStage();
      renderParticipants();
    });

    state.socket.on('meet:chat', ({ from, message, at }) => {
      appendChat(from, message, at, false);
    });

    state.socket.on('meet:host-action', ({ type }) => {
      if (type === 'mute') {
        state.audioLocked = true;
        state.micOn = false;
        const t = state.localStream && state.localStream.getAudioTracks()[0];
        if (t) t.enabled = false;
        updateControls(); renderStage(); renderParticipants();
        toast('🔇 Host muted your microphone');
      } else if (type === 'unmute') {
        state.audioLocked = false;
        toast('🔊 Host unmuted your microphone');
      } else if (type === 'camera-off') {
        state.videoLocked = true;
        state.camOn = false;
        const t = state.localStream && state.localStream.getVideoTracks()[0];
        if (t) t.enabled = false;
        updateControls(); renderStage(); renderParticipants();
        toast('📵 Host turned off your camera');
      } else if (type === 'kick') {
        showKickedModal();
      }
    });

    state.socket.on('meet:kicked', ({ by }) => {
      showKickedModal();
    });

    state.socket.on('disconnect', () => {
      if (!state.kicked) toast('Connection lost. Reconnecting...');
    });
  }

  /* ================= WEBRTC PEERS ================= */
  function createPeer(id, initiator) {
    if (state.peers[id]) return state.peers[id];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' });
    state.peers[id] = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketEmit('meet:signal', { roomId: state.roomId, target: id, data: { type: 'ice', candidate: e.candidate } });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        try { pc.restartIce(); } catch (e) {}
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      state.remoteStreams[id] = stream;
      const info = state.remoteStates[id] || (state.remoteStates[id] = { audioMuted: false, videoMuted: false, sharing: false });
      stream.getTracks().forEach((t) => {
        if (t.kind === 'audio') {
          t.onmute = () => { info.audioMuted = true; renderStage(); renderParticipants(); };
          t.onunmute = () => { info.audioMuted = false; renderStage(); renderParticipants(); };
          t.onended = () => { info.audioMuted = true; renderStage(); renderParticipants(); };
        }
        if (t.kind === 'video') {
          t.onmute = () => { info.videoMuted = true; renderStage(); renderParticipants(); };
          t.onunmute = () => { info.videoMuted = false; renderStage(); renderParticipants(); };
          t.onended = () => { info.videoMuted = true; renderStage(); renderParticipants(); };
        }
      });
      const tile = document.getElementById('video-' + id);
      if (tile) tile.srcObject = stream;
      renderStage();
      renderParticipants();
    };

    addTracks(pc);

    if (initiator) negotiate(id);
    return pc;
  }

  function addTracks(pc) {
    if (pc.getSenders().length > 0) return;
    if (!state.localStream) return;
    state.localStream.getTracks().forEach((t) => pc.addTrack(t, state.localStream));
  }

  function addTracksToPeers() {
    for (const id in state.peers) {
      const pc = state.peers[id];
      addTracks(pc);
      applyQuality(pc);
    }
    for (const id in state.peers) negotiate(id);
  }

  async function negotiate(id) {
    const pc = state.peers[id];
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      applyQuality(pc);
      socketEmit('meet:signal', { roomId: state.roomId, target: id, data: { type: 'offer', sdp: pc.localDescription } });
    } catch (e) { console.error('negotiate error', e); }
  }

  async function handleSignal(from, data) {
    let pc = state.peers[from];
    if (!pc) pc = createPeer(from, false);
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        applyQuality(pc);
        socketEmit('meet:signal', { roomId: state.roomId, target: from, data: { type: 'answer', sdp: pc.localDescription } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(data.sdp);
      } else if (data.type === 'ice') {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (e) {
      console.error('signal handling error', e);
    }
  }

  function closePeer(id) {
    const pc = state.peers[id];
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    }
    delete state.peers[id];
  }

  /* ================= HOST CONTROLS ================= */
  function hostMute(id) {
    const info = state.remoteStates[id] || {};
    if (info.audioMuted) {
      socketEmit('meet:host-unmute', { roomId: state.roomId, target: id });
      toast('Unmuted ' + state.users[id].name);
    } else {
      socketEmit('meet:host-mute', { roomId: state.roomId, target: id });
      toast('Muted ' + state.users[id].name);
    }
  }

  function hostStopCam(id) {
    socketEmit('meet:host-camera-off', { roomId: state.roomId, target: id });
    toast('Stopped camera of ' + state.users[id].name);
  }

  function hostKick(id) {
    if (!confirm('Remove ' + state.users[id].name + ' from this meeting?')) return;
    socketEmit('meet:host-kick', { roomId: state.roomId, target: id });
    closePeer(id);
    delete state.users[id];
    delete state.remoteStreams[id];
    delete state.remoteStates[id];
    renderStage();
    renderParticipants();
    toast(state.users[id] ? '' : 'Participant removed');
  }

  /* ================= RENDER STAGE ================= */
  function renderStage() {
    const ids = Object.keys(state.users);
    const sharingIds = ids.filter((id) => (state.remoteStates[id] && state.remoteStates[id].sharing) || (id === state.myId && state.sharing));

    if (!ids.length) {
      stage.innerHTML = '<div class="stage-empty"><span class="big">🐆</span><span>Waiting for others to join...<br>Share the invite link to bring people in.</span></div>';
      stage.classList.remove('spotlight');
      return;
    }

    stage.classList.toggle('spotlight', sharingIds.length > 0);
    stage.innerHTML = ids.map((id) => tileHTML(id)).join('');
    ids.forEach((id) => {
      const tile = document.getElementById('video-' + id);
      const stream = id === state.myId
        ? (state.sharing ? state.screenStream : state.localStream)
        : state.remoteStreams[id];
      if (tile && stream) tile.srcObject = stream;
    });
  }

  function tileHTML(id) {
    const me = id === state.myId;
    const u = state.users[id];
    const info = state.remoteStates[id] || { audioMuted: false, videoMuted: false, sharing: false };
    const sharing = info.sharing;
    const camOff = me ? !state.camOn && !state.sharing : info.videoMuted;
    const audioMuted = me ? !state.micOn : info.audioMuted;
    const isHost = u ? u.isHost : false;

    let name = me ? state.name + ' (You)' : u.name;
    let hostBadge = isHost ? '<span class="tile-badge-host">HOST</span>' : '';
    let badges = '';
    if (audioMuted) badges += '<span class="tile-badge" title="Muted">🔇</span>';
    if (camOff) badges += '<span class="tile-badge" title="Camera off">📵</span>';

    let shareBanner = sharing ? '<div class="share-banner">🖥️ Sharing screen</div>' : '';

    let actions = '';
    if (!me && state.isHost) {
      actions =
        '<div class="tile-actions">' +
        '<button class="act-mute" onclick="window.__meetHostMute(\'' + id + '\')" title="Mute / unmute">' + (audioMuted ? '🔊' : '🔇') + '</button>' +
        '<button class="act-cam" onclick="window.__meetHostCam(\'' + id + '\')" title="Turn camera off">📵</button>' +
        '<button class="act-danger" onclick="window.__meetHostKick(\'' + id + '\')" title="Remove from meeting">✖</button>' +
        '</div>';
    }

    const video = sharing || !camOff
      ? '<video id="video-' + id + '" autoplay playsinline muted="' + me + '"></video>'
      : '';

    let avatar = '';
    if (camOff) {
      avatar =
        '<div class="tile-avatar"><div class="av">' + initials(name) + '</div><div class="av-name">' + escapeHtml(name) + '</div></div>';
    }

    const cls = 'tile' + (sharing ? ' sharing' : '') + (isHost ? ' host-tile' : '');
    return (
      '<div class="' + cls + '" data-id="' + id + '">' +
      shareBanner +
      video +
      avatar +
      '<div class="tile-meta">' +
      '<span class="tile-name">' + hostBadge + '<span class="nm">' + escapeHtml(name) + '</span></span>' +
      badges +
      '</div>' +
      actions +
      '</div>'
    );
  }

  /* ================= PARTICIPANTS ================= */
  function renderParticipants() {
    const ids = Object.keys(state.users);
    pcountEl.textContent = ids.length;
    participantsList.innerHTML = ids.map((id) => {
      const me = id === state.myId;
      const u = state.users[id];
      const info = state.remoteStates[id] || { audioMuted: false, videoMuted: false, sharing: false };
      const audioMuted = me ? !state.micOn : info.audioMuted;
      const camOff = me ? !state.camOn && !state.sharing : info.videoMuted;
      const name = (me ? state.name + ' (You)' : u.name);
      const hostBadge = u.isHost ? '<span class="p-host-badge">HOST</span>' : '';
      return (
        '<div class="p-item">' +
        '<div class="p-av">' + initials(name) + '</div>' +
        '<div class="p-info">' +
        '<div class="p-name">' + escapeHtml(name) + '</div>' +
        '<div class="p-sub">' + hostBadge + (info.sharing ? ' <span>🖥️ Sharing</span>' : '') + '</div>' +
        '</div>' +
        '<div class="p-status">' +
        '<span title="Microphone">' + (audioMuted ? '🔇' : '🎙️') + '</span>' +
        '<span title="Camera">' + (camOff ? '📵' : '📷') + '</span>' +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* ================= CHAT ================= */
  function addSysChat(text) {
    appendChat('', text, Date.now(), true);
  }

  function appendChat(from, message, at, system) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (from === state.name && !system ? ' mine' : '');
    const t = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (system) {
      div.innerHTML = '<span class="c-sys">' + escapeHtml(message) + '</span>';
    } else {
      div.innerHTML =
        '<div class="c-head"><span class="c-name">' + escapeHtml(from) + '</span><span class="c-time">' + t + '</span></div>' +
        '<div class="c-bubble">' + escapeHtml(message).replace(/\n/g, '<br>') + '</div>';
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    appendChat(state.name, msg, Date.now(), false);
    socketEmit('meet:chat', { roomId: state.roomId, message: msg });
  }

  /* ================= UI CONTROLS ================= */
  function updateControls() {
    btnMic.classList.toggle('off', !state.micOn);
    btnMic.classList.toggle('on', state.micOn && !state.audioLocked);
    if (state.audioLocked) btnMic.classList.add('off');
    btnCam.classList.toggle('off', !state.camOn && !state.sharing);
    btnScreen.classList.toggle('off', state.sharing);
    document.getElementById('ico-mic').textContent = state.micOn ? '🎤' : '🔇';
    document.getElementById('ico-cam').textContent = (state.camOn || state.sharing) ? '📷' : '📵';
    document.getElementById('ico-screen').textContent = state.sharing ? '⏹' : '🖥️';
  }

  /* ================= INVITE ================= */
  async function copyInvite() {
    const link = location.origin + '/meet/' + state.roomId;
    try {
      await navigator.clipboard.writeText(link);
      toast('🔗 Invite link copied: ' + link);
    } catch (e) {
      prompt('Copy this invite link and send it to anyone:', link);
    }
  }

  /* ================= LEAVE / CLEANUP ================= */
  function cleanup() {
    clearInterval(state.timerInt);
    clearTimeout(state.toastInt);
    if (state.socket) {
      if (!state.kicked) state.socket.emit('meet:leave', { roomId: state.roomId });
      state.socket.removeAllListeners();
      state.socket.disconnect();
      state.socket = null;
    }
    for (const id in state.peers) closePeer(id);
    state.peers = {};
    state.users = {};
    state.remoteStreams = {};
    state.remoteStates = {};
    if (state.localStream) {
      state.localStream.getTracks().forEach((t) => t.stop());
      state.localStream = null;
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach((t) => t.stop());
      state.screenStream = null;
    }
    state.sharing = false;
    state.micOn = true;
    state.camOn = true;
    state.audioLocked = false;
    state.videoLocked = false;
    state.kicked = false;
    state.isHost = false;
    stage.innerHTML = '';
    chatMessages.innerHTML = '';
    timerEl.textContent = '00:00';
    updateControls();
  }

  function leaveMeeting() {
    cleanup();
    showScreen(lobby);
  }

  function showKickedModal() {
    state.kicked = true;
    modal.classList.remove('hidden');
  }

  /* ================= LOBBY ================= */
  function setupLobby() {
    const saved = localStorage.getItem('leopards-name');
    if (saved) lobbyName.value = saved;

    // prefill from URL /meet/:room
    const m = location.pathname.match(/^\/meet\/([A-Za-z0-9]+)/);
    if (m && m[1]) {
      lobbyRoom.value = m[1].toUpperCase();
    } else if (!lobbyRoom.value) {
      lobbyRoom.value = genRoomCode(6);
    }

    btnRandomRoom.addEventListener('click', () => {
      lobbyRoom.value = genRoomCode(6);
    });

    btnJoin.addEventListener('click', startMeeting);
    lobbyName.addEventListener('keydown', (e) => { if (e.key === 'Enter') startMeeting(); });
    lobbyRoom.addEventListener('keydown', (e) => { if (e.key === 'Enter') startMeeting(); });
  }

  async function startMeeting() {
    const name = lobbyName.value.trim();
    if (!name) { toast('Please enter your name first'); lobbyName.focus(); return; }
    const room = lobbyRoom.value.trim().toUpperCase();
    if (!room) { toast('Please enter a meeting code'); lobbyRoom.focus(); return; }

    localStorage.setItem('leopards-name', name);
    state.name = name;
    state.roomId = room;
    state.kicked = false;

    showScreen(meeting);
    startTimer();
    updateControls();

    try { await getMedia(); } catch (e) { toast('Camera or microphone not available — joining without media'); }
    connect();
  }

  /* ================= ESCAPE ================= */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ================= EVENT WIRING ================= */
  btnMic.addEventListener('click', toggleMic);
  btnCam.addEventListener('click', toggleCam);
  btnScreen.addEventListener('click', toggleScreen);
  btnInvite.addEventListener('click', copyInvite);
  btnLeave.addEventListener('click', () => { if (confirm('Leave this meeting?')) leaveMeeting(); });

  btnPeople.addEventListener('click', () => {
    sidepanel.classList.remove('hidden');
    tabParticipants.classList.add('active');
    tabChat.classList.remove('active');
    panelParticipants.classList.remove('hidden');
    panelChat.classList.add('hidden');
  });
  btnChat.addEventListener('click', () => {
    sidepanel.classList.remove('hidden');
    tabChat.classList.add('active');
    tabParticipants.classList.remove('active');
    panelChat.classList.remove('hidden');
    panelParticipants.classList.add('hidden');
    chatInput.focus();
  });
  tabParticipants.addEventListener('click', () => {
    tabParticipants.classList.add('active');
    tabChat.classList.remove('active');
    panelParticipants.classList.remove('hidden');
    panelChat.classList.add('hidden');
  });
  tabChat.addEventListener('click', () => {
    tabChat.classList.add('active');
    tabParticipants.classList.remove('active');
    panelChat.classList.remove('hidden');
    panelParticipants.classList.add('hidden');
    chatInput.focus();
  });
  chatForm.addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  modalBtn.addEventListener('click', () => { modal.classList.add('hidden'); leaveMeeting(); });

  window.__meetHostMute = hostMute;
  window.__meetHostCam = hostStopCam;
  window.__meetHostKick = hostKick;

  window.addEventListener('beforeunload', () => {
    if (state.socket && state.socket.connected) {
      state.socket.emit('meet:leave', { roomId: state.roomId });
    }
  });

  /* ================= INIT ================= */
  setupLobby();
  showScreen(lobby);
})();