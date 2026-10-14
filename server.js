const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const WORD_PAIRS = [
  ['apple','banana'],['cat','dog'],['pizza','burger'],['ocean','lake'],['moon','sun'],['pencil','pen'],['soccer','basketball'],['winter','summer'],['train','bus'],['cake','cookie'],['shark','dolphin'],['mountain','hill'],['coffee','tea'],['book','magazine'],['guitar','piano'],['tiger','lion'],['school','library'],['rain','snow'],['popcorn','chips'],['robot','alien'],['beach','pool'],['doctor','nurse'],['eagle','owl'],['pancake','waffle'],['dragon','dinosaur'],['skateboard','scooter'],['planet','star'],['pillow','blanket'],['camera','phone'],['forest','jungle']
];
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const cleanName = s => String(s || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18) || 'Player';
function roomPublic(r) {
  return { code:r.code, hostId:r.hostId, phase:r.phase, round:r.round, maxPlayers:r.maxPlayers,
    players:[...r.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,ready:p.ready,score:p.score,hasClue:!!r.clues[p.id],voted:!!r.votes[p.id]})),
    clues:r.phase==='clues'||r.phase==='voting'||r.phase==='results' ? r.turnOrder.filter(id=>r.clues[id]).map(id=>({id,name:r.players.get(id)?.name,clue:r.clues[id]})) : [],
    votes:r.phase==='results' ? Object.entries(r.votes).map(([voter,target])=>({voter:r.players.get(voter)?.name,target:r.players.get(target)?.name})) : [],
    result:r.phase==='results'?r.result:null, word:r.phase==='results'?r.words:null, turn:r.phase==='clues'?r.turnOrder[r.turnIndex]:null,
    turnIndex:r.turnIndex, turnCount:r.turnOrder.length, timerEndsAt:r.timerEndsAt||null };
}
function emitRoom(r) { io.to(r.code).emit('state', roomPublic(r)); }
function startTimer(r, seconds, callback) { clearTimeout(r.timer); r.timerEndsAt=Date.now()+seconds*1000; r.timer=setTimeout(()=>{callback();},seconds*1000); }
function startRound(r) {
  const players=[...r.players.values()]; if(players.length<3) return false;
  r.round++; r.phase='words'; r.clues={}; r.votes={}; r.result=null; r.turnIndex=0;
  const pair=WORD_PAIRS[Math.floor(Math.random()*WORD_PAIRS.length)]; const odd=players[Math.floor(Math.random()*players.length)];
  r.words={}; r.oddId=odd.id; players.forEach(p=>r.words[p.id]=p.id===odd.id?pair[1]:pair[0]);
  r.turnOrder=players.map(p=>p.id).sort(()=>Math.random()-.5); r.timerEndsAt=null;
  players.forEach(p=>io.to(p.id).emit('your-word',{word:r.words[p.id],round:r.round}));
  emitRoom(r); return true;
}
function finishClues(r) { clearTimeout(r.timer); r.phase='voting'; r.timerEndsAt=Date.now()+30000; emitRoom(r); startTimer(r,30,()=>finishVoting(r)); }
function finishVoting(r) {
  if(r.phase!=='voting')return; clearTimeout(r.timer);
  const tally={}; Object.values(r.votes).forEach(id=>tally[id]=(tally[id]||0)+1);
  const max=Math.max(0,...Object.values(tally)); const top=Object.keys(tally).filter(id=>tally[id]===max);
  // The odd word is the word with the lower frequency; ties fall back to the selected outlier stored at round start.
  const caught=top.length===1 && top[0]===r.oddId;
  for(const p of r.players.values()) {
    const correct=r.votes[p.id]===r.oddId;
    if(correct) p.score+=100;
    if(p.id===r.oddId && !caught) p.score+=100;
    if(p.id===r.oddId && caught) p.score+=25;
  }
  r.result={oddId:r.oddId,oddName:r.players.get(r.oddId)?.name,caught, tally, totalVotes:Object.keys(r.votes).length};
  r.phase='results'; r.timerEndsAt=null; emitRoom(r);
}
io.on('connection', socket=>{
  socket.on('create-room', ({name,avatar,maxPlayers}={})=>{
    let c; do {c=code()} while(rooms.has(c));
    const r={code:c,hostId:socket.id,phase:'lobby',round:0,maxPlayers:Math.max(4,Math.min(30,Number(maxPlayers)||12)),players:new Map(),clues:{},votes:{},words:{},turnOrder:[],turnIndex:0,oddId:null,timer:null,timerEndsAt:null,result:null};
    r.players.set(socket.id,{id:socket.id,name:cleanName(name),avatar:avatar||'😎',ready:true,score:0}); rooms.set(c,r); socket.join(c); socket.data.room=c; socket.emit('joined',{code:c,id:socket.id}); emitRoom(r);
  });
  socket.on('join-room', ({code:c,name,avatar}={})=>{
    c=String(c||'').trim().toUpperCase(); const r=rooms.get(c);
    if(!r)return socket.emit('error-message','Room not found. Check the code and try again.');
    if(r.players.size>=r.maxPlayers)return socket.emit('error-message','This room is full.');
    if(r.phase!=='lobby')return socket.emit('error-message','This game has already started. Ask the host to create a new room.');
    r.players.set(socket.id,{id:socket.id,name:cleanName(name),avatar:avatar||'🙂',ready:false,score:0}); socket.join(c); socket.data.room=c; socket.emit('joined',{code:c,id:socket.id}); emitRoom(r);
  });
  socket.on('start-game',()=>{const r=rooms.get(socket.data.room); if(!r||r.hostId!==socket.id)return; if(r.players.size<3)return socket.emit('error-message','You need at least 3 players to start.'); startRound(r);});
  socket.on('submit-clue',({clue}={})=>{const r=rooms.get(socket.data.room); if(!r||r.phase!=='words'&&r.phase!=='clues')return; if(r.turnOrder[r.turnIndex]!==socket.id)return socket.emit('error-message','Wait for your turn.'); const c=String(clue||'').trim(); if(!c||/\s/.test(c)||c.length>24)return socket.emit('error-message','Enter a single word (up to 24 characters).'); r.clues[socket.id]=c; r.phase='clues'; r.turnIndex++; if(r.turnIndex>=r.turnOrder.length)finishClues(r); else emitRoom(r); });
  socket.on('skip-to-vote',()=>{const r=rooms.get(socket.data.room);if(!r||r.hostId!==socket.id||!['words','clues'].includes(r.phase))return;finishClues(r);});
  socket.on('cast-vote',({target}={})=>{const r=rooms.get(socket.data.room);if(!r||r.phase!=='voting'||!r.players.has(target)||target===socket.id)return socket.emit('error-message','That vote is not valid.');r.votes[socket.id]=target;if(Object.keys(r.votes).length>=r.players.size)finishVoting(r);else emitRoom(r);});
  socket.on('next-round',()=>{const r=rooms.get(socket.data.room);if(!r||r.hostId!==socket.id||r.phase!=='results')return;startRound(r);});
  socket.on('play-again',()=>{const r=rooms.get(socket.data.room);if(!r||r.hostId!==socket.id)return;clearTimeout(r.timer);r.phase='lobby';r.round=0;r.players.forEach(p=>{p.score=0;p.ready=p.id===r.hostId});r.timerEndsAt=null;emitRoom(r);});
  socket.on('disconnect',()=>{const c=socket.data.room;const r=rooms.get(c);if(!r)return;r.players.delete(socket.id);delete r.clues[socket.id];delete r.votes[socket.id];delete r.words[socket.id];r.turnOrder=r.turnOrder.filter(id=>id!==socket.id);if(r.hostId===socket.id){r.hostId=r.players.keys().next().value;if(r.hostId&&r.players.get(r.hostId))r.players.get(r.hostId).ready=true;}if(!r.players.size){clearTimeout(r.timer);rooms.delete(c);return;}if(r.phase==='voting'&&Object.keys(r.votes).length>=r.players.size)finishVoting(r);else emitRoom(r);});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Odd One Out running on port ${PORT}`));
