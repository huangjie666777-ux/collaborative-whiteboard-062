import React, { useState } from 'react';

export function JoinScreen(props: { onJoin: (name: string, room: string) => void }) {
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState('');
  const [room, setRoom] = useState(params.get('room') ?? '');
  return (
    <div className="join">
      <h1>实时协作白板</h1>
      <input placeholder="昵称" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="房间号" value={room} onChange={(e) => setRoom(e.target.value)} />
      <button disabled={!name.trim() || !room.trim()} onClick={() => props.onJoin(name.trim(), room.trim())}>
        加入白板
      </button>
    </div>
  );
}
