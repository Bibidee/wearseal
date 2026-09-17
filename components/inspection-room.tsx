'use client';

import {useRef, useState} from 'react';

type Mode = 'SIDE BY SIDE' | 'SLIDER' | 'BLINK' | 'ZOOM';

export default function InspectionRoom({checkoutUrl, returnUrl, mode, onModeChange}: {checkoutUrl: string; returnUrl: string; mode: Mode; onModeChange: (mode: Mode) => void}) {
  const [position, setPosition] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({x: 0, y: 0});
  const [blinking, setBlinking] = useState(true);
  const drag = useRef<{x: number; y: number; ox: number; oy: number} | null>(null);
  const modes: Mode[] = ['SIDE BY SIDE', 'SLIDER', 'BLINK', 'ZOOM'];
  const resetZoom = () => { setZoom(1); setOffset({x: 0, y: 0}); };
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'ZOOM' || zoom === 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y};
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y});
  };
  return <div className="inspection-room">
    <div className="inspection-controls" role="tablist" aria-label="Evidence comparison modes">
      {modes.map(item => <button key={item} className={`wallet-button ${mode === item ? 'active-mode' : ''}`} onClick={() => onModeChange(item)} role="tab" aria-selected={mode === item}>{item}</button>)}
    </div>
    <div className="eyebrow inspection-kicker">HASH-BOUND VISUAL WORKSPACE · {mode}</div>
    {mode === 'SLIDER' && <div className="inspection-stage slider-stage">
      <img className="inspection-base" src={checkoutUrl} alt="Authoritative checkout evidence" />
      <div className="inspection-overlay" style={{width: `${position}%`}}><img src={returnUrl} alt="Authoritative return evidence" /></div>
      <div className="inspection-divider" style={{left: `${position}%`}} aria-hidden="true"><span>↔</span></div>
      <input className="inspection-range" type="range" min="2" max="98" value={position} onChange={event => setPosition(Number(event.target.value))} aria-label="Compare checkout and return evidence" />
      <span className="inspection-label label-left">RETURN</span><span className="inspection-label label-right">CHECKOUT</span>
    </div>}
    {mode === 'SIDE BY SIDE' && <div className="inspection-images"><figure><img src={checkoutUrl} alt="Authoritative checkout evidence" /><figcaption>CHECKOUT</figcaption></figure><figure><img src={returnUrl} alt="Authoritative return evidence" /><figcaption>RETURN</figcaption></figure></div>}
    {mode === 'BLINK' && <div className="blink-stage"><img className={blinking ? 'blink-image' : ''} src={checkoutUrl} alt="Checkout evidence blink comparison" /><img className={blinking ? 'blink-image blink-return' : 'blink-return visible'} src={returnUrl} alt="Return evidence blink comparison" /><button className="blink-toggle" onClick={() => setBlinking(value => !value)} aria-pressed={blinking}>{blinking ? 'PAUSE BLINK' : 'RESUME BLINK'}</button></div>}
    {mode === 'ZOOM' && <div className="zoom-stage" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={() => {drag.current = null;}} onPointerCancel={() => {drag.current = null;}} style={{cursor: zoom > 1 ? 'grab' : 'default'}}><img src={returnUrl} alt="Return evidence zoom view" style={{transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`}} /><div className="zoom-controls"><button className="wallet-button" onClick={() => setZoom(value => Math.min(3, value + .25))} aria-label="Zoom in">+</button><span className="mono">{Math.round(zoom * 100)}%</span><button className="wallet-button" onClick={() => setZoom(value => Math.max(1, value - .25))} aria-label="Zoom out">−</button><button className="wallet-button" onClick={resetZoom}>RESET</button></div></div>}
    <p className="mono inspection-note">Evidence is displayed from the URLs committed in Agreement state. No region boxes are fabricated.</p>
  </div>;
}
