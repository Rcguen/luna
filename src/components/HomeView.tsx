import type { Session } from '@supabase/supabase-js';
import type { GameRecord } from '../lib/cloudSaves';
import { AuthPanel } from './AuthPanel';
import { GameLibrary } from './GameLibrary';

export type OnlineMode = 'stream' | 'distributed';

type Props = {
  room: string;
  roomCapacity: number;
  onlineMode: OnlineMode;
  romName: string;
  romLoaded: boolean;
  romLoading: boolean;
  status: string;
  session: Session | null;
  libraryRefresh: number;
  onRoom: (value: string) => void;
  onCapacity: (value: number) => void;
  onMode: (value: OnlineMode) => void;
  onLoadRom: (file: File) => void;
  onSolo: () => void;
  onCreateRoom: () => void;
  onJoin: () => void;
  onSession: (session: Session | null) => void;
  onLoadGame: (game: GameRecord) => Promise<void>;
};

const markUrl = `${import.meta.env.BASE_URL}luna-mark.svg`;

export function HomeView({
  room, roomCapacity, onlineMode, romName, romLoaded, romLoading, status,
  session, libraryRefresh, onRoom, onCapacity, onMode, onLoadRom,
  onSolo, onCreateRoom, onJoin, onSession, onLoadGame,
}: Props) {
  return <div className="hub" id="top">
    <header className="hub-header">
      <a className="brand-lockup" href="#top" aria-label="Luna home">
        <img src={markUrl} width="42" height="42" alt="" />
        <span>Luna<small>YOUR GAME SPACE</small></span>
      </a>
      <nav className="hub-nav" aria-label="Main navigation">
        <a href="#play">Play</a><a href="#library">Library</a><a href="#account">Account</a>
      </nav>
      <span className="header-chip"><span aria-hidden="true" /> GBA is ready</span>
    </header>

    <main className="hub-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">WELCOME TO YOUR GAME SPACE</p>
          <h1 id="hero-title">A little escape,<br /><em>whenever you want.</em></h1>
          <p>Bring your own games, pick up where you left off, and play together from anywhere.</p>
          <a className="hero-link" href="#play">Start playing <span aria-hidden="true">↗</span></a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-spark spark-one">✦</div><div className="hero-spark spark-two">✳</div>
          <div className="handheld">
            <div className="handheld-screen"><div className="pixel-moon" /><span>READY<br />PLAYER ONE</span><div className="pixel-hills" /></div>
            <div className="handheld-controls"><span className="handheld-dpad">✚</span><span className="handheld-buttons">● &nbsp; ●</span></div>
          </div>
          <div className="hero-sticker">PLAY<br />YOUR WAY <span>✦</span></div>
        </div>
      </section>

      <section className="platforms" aria-label="Game systems">
        <div className="platform-intro"><span className="eyebrow">EXPLORE SYSTEMS</span><strong>One home for every era.</strong></div>
        <div className="platform-card available"><span className="platform-icon">GBA</span><span><strong>Game Boy Advance</strong><small>Play now</small></span><span className="platform-arrow" aria-hidden="true">↗</span></div>
        <div className="platform-card future"><span className="platform-icon">DS</span><span><strong>Nintendo DS</strong><small>Planned</small></span></div>
        <div className="platform-card future"><span className="platform-icon">PS</span><span><strong>PlayStation</strong><small>Planned</small></span></div>
      </section>

      <div className="dashboard">
        <div className="dashboard-main">
          <section className="play-card" id="play" aria-labelledby="play-heading">
            <div className="section-heading"><div><p className="eyebrow">JUMP BACK IN</p><h2 id="play-heading">Ready to play?</h2></div><span className="section-counter">01 / GBA</span></div>
            <div className={`selected-game${romLoaded ? ' is-ready' : ''}`}>
              <div className="selected-art" aria-hidden="true"><span>✦</span><small>GBA</small></div>
              <div className="selected-copy"><span className="game-kicker">{romLoaded ? 'CURRENT GAME' : 'YOUR NEXT ADVENTURE'}</span><h3 title={romLoaded ? romName : undefined}>{romLoaded ? romName : 'Choose a game to begin'}</h3><p>{romLoaded ? 'Your ROM is ready on this device.' : 'Load a legally obtained GBA game from your device.'}</p></div>
              <span className={`ready-pill${romLoaded ? ' is-ready' : ''}`}>{romLoaded ? 'READY' : 'NO GAME'}</span>
            </div>
            <label className={`file-button home-file${romLoading ? ' is-busy' : ''}`}>{romLoading ? 'Loading game…' : romLoaded ? 'Change game' : 'Add a GBA game'}<input aria-label="Load a legal ROM" type="file" accept=".gba,.gb,.gbc" disabled={romLoading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onLoadRom(file); event.currentTarget.value = ''; }} /></label>

            <div className="play-divider"><span>HOW DO YOU WANT TO PLAY?</span></div>
            <div className="room-settings">
              <label>Players in room<select id="room-capacity" value={roomCapacity} onChange={(event) => onCapacity(Number(event.target.value))}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label>
              <label>Online mode<select id="online-mode" value={onlineMode} onChange={(event) => onMode(event.target.value as OnlineMode)}><option value="stream">Host streams the game</option><option value="distributed">Everyone has the same ROM</option></select></label>
            </div>
            <p className="mode-explainer">{onlineMode === 'distributed' ? 'Each player loads the same ROM. Video and sound run locally on every device.' : 'Only the host needs a ROM. Guests receive their own video and sound stream.'}</p>
            <div className="primary-actions"><button className="secondary" onClick={onSolo} disabled={romLoading || !romLoaded}>Play solo</button><button onClick={onCreateRoom} disabled={romLoading || !romLoaded}>Create room <span aria-hidden="true">↗</span></button></div>
            <div className="join-card"><div><strong>Have a room code?</strong><small>{onlineMode === 'distributed' ? 'Load the same ROM before joining.' : 'Join without loading a ROM.'}</small></div><div className="join-row"><input aria-label="Six-digit room code" inputMode="numeric" maxLength={6} placeholder="6-DIGIT CODE" value={room} onChange={(event) => onRoom(event.target.value.replace(/\D/g, ''))} /><button className="secondary" onClick={onJoin}>Join room</button></div></div>
            <p className="status" role="status">{status}</p>
          </section>

          <div id="library" className="library-section">
            <GameLibrary userId={session?.user.id || null} refreshKey={libraryRefresh} onLoadGame={onLoadGame} />
            {!session && <section className="library library-preview"><div className="library-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h2>Game library</h2></div><span className="library-symbol" aria-hidden="true">✦</span></div><p>Sign in to keep your game list and cloud saves together. ROM files stay on your device.</p></section>}
          </div>
        </div>

        <aside className="dashboard-side">
          <div id="account"><AuthPanel onSession={onSession} /></div>
          <section className="help-card"><p className="eyebrow">QUICK CONTROLS</p><h2>Play your way.</h2><p>Use your keyboard on desktop or the touch controller on your phone.</p><div className="key-guide"><span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> Move</span><span><kbd>Z</kbd> A <kbd>X</kbd> B</span><span><kbd>Enter</kbd> Start</span></div></section>
        </aside>
      </div>
    </main>
    <footer className="hub-footer"><span>Luna <span aria-hidden="true">✦</span> Your games, your space.</span><span>Bring your own games. Play together.</span></footer>
  </div>;
}
