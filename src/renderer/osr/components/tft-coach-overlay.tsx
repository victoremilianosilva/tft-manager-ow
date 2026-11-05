import React, { useState } from 'react';

type ActionKind = 'XP' | 'ROLL' | 'BUY';

const units = [
  { name: 'Ahri', cost: 4, trait: 'Arcanista', role: 'Carry', mark: 'A' },
  { name: 'Annie', cost: 4, trait: 'Arcanista', role: 'Front', mark: 'A' },
  { name: 'Rumble', cost: 3, trait: 'Sucateiro', role: 'Front', mark: 'R' },
  { name: 'Vex', cost: 3, trait: 'Arcanista', role: 'Utility', mark: 'V' },
  { name: 'Ekko', cost: 3, trait: 'Sucateiro', role: 'Front', mark: 'E' },
  { name: 'Jinx', cost: 4, trait: 'Atirador', role: 'Carry', mark: 'J' },
  { name: 'Ziggs', cost: 2, trait: 'Sucateiro', role: 'Flex', mark: 'Z' },
  { name: 'Seraphine', cost: 2, trait: 'Arcanista', role: 'Flex', mark: 'S' },
];

const TFTCoachOverlay: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionKind>('XP');

  const actionCopy: Record<ActionKind, { title: string; detail: string; reason: string; button: string }> = {
    XP: { title: 'COMPRAR XP', detail: 'Subir para nível 7', reason: 'Aumentar a chance de encontrar unidades de custo 4 e completar a linha principal.', button: 'Ver plano de nível' },
    ROLL: { title: 'ROLAR LOJA', detail: 'Procurar Ahri / Annie', reason: 'Você já tem pares importantes. Uma rodada curta de roll pode estabilizar o tabuleiro.', button: 'Ver unidades-alvo' },
    BUY: { title: 'COMPRAR UNIDADE', detail: 'Comprar Ahri', reason: 'Entra na composição e aproxima o upgrade. Há espaço disponível no banco.', button: 'Ver composição' },
  };

  const action = actionCopy[activeAction];

  return (
    <div className="akame-coach">
      <style>{`
        .akame-coach{font-family:Inter,Segoe UI,Arial,sans-serif;color:#f4f2fa;background:rgba(12,13,20,.96);border:1px solid #454052;border-radius:12px;box-shadow:0 12px 38px #0009;overflow:hidden;width:min(430px,100%);font-size:12px}
        .akame-top{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;background:linear-gradient(100deg,#241a36,#171923);border-bottom:1px solid #393344}
        .akame-brand{font-weight:900;letter-spacing:1.5px;font-size:13px}.akame-live{color:#9ce8bc;font-size:10px;font-weight:800;letter-spacing:.8px}
        .akame-stats{display:flex;gap:12px;color:#d4d0dc}.akame-stats b{color:#fff}
        .akame-comp{padding:12px 13px 10px;border-bottom:1px solid #34313d}.akame-label{color:#aaa4b6;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
        .akame-comp-head{display:flex;justify-content:space-between;align-items:center;margin:5px 0 9px}.akame-comp-title{font-size:15px;font-weight:850}.akame-open{background:#30283d;border:1px solid #66547d;color:#e8d9ff;border-radius:6px;padding:6px 8px;font-size:10px;cursor:pointer}
        .akame-units{display:grid;grid-template-columns:repeat(8,1fr);gap:5px}.akame-unit{min-width:0;text-align:center}.akame-avatar{height:37px;border-radius:6px;background:linear-gradient(145deg,#55416c,#282d43);border:1px solid #79648e;display:grid;place-items:center;font-weight:900;font-size:15px;color:#f8eaff}.akame-unit small{display:block;color:#c8c2d0;font-size:9px;margin-top:3px;overflow:hidden;text-overflow:ellipsis}
        .akame-traits{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.akame-trait{background:#292632;border:1px solid #45404e;border-radius:4px;padding:3px 6px;color:#d2cbd9;font-size:9px}
        .akame-decision{padding:12px 13px;background:linear-gradient(110deg,#201b2b,#171923);border-bottom:1px solid #34313d}.akame-decision-head{display:flex;align-items:center;justify-content:space-between}.akame-priority{color:#f3c879;font-size:9px;font-weight:900;letter-spacing:.8px}.akame-decision h3{font-size:17px;margin:5px 0 2px}.akame-detail{color:#d8c8ee;font-weight:700}.akame-reason{color:#aaa5b1;line-height:1.45;margin:7px 0 10px}.akame-action-row{display:flex;gap:6px}.akame-action{flex:1;border:1px solid #51475f;border-radius:6px;background:#292532;color:#c9c2d0;padding:7px 4px;font-size:10px;cursor:pointer}.akame-action.active{background:#5a397b;border-color:#a77bd2;color:white;font-weight:800}
        .akame-bottom{padding:10px 13px;display:flex;justify-content:space-between;align-items:center;color:#aaa5b1}.akame-bottom b{color:#fff}.akame-tag{color:#9ce8bc;font-weight:800}
        .akame-modal-backdrop{position:fixed;inset:0;background:#05050ab8;display:grid;place-items:center;padding:18px;z-index:20}.akame-modal{width:min(720px,95vw);max-height:85vh;overflow:auto;background:#171720;border:1px solid #51475f;border-radius:12px;box-shadow:0 20px 70px #000c;padding:17px}.akame-modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.akame-modal h2{font-size:18px;margin:0}.akame-board{display:grid;grid-template-columns:repeat(7,1fr);gap:7px;padding:12px;background:linear-gradient(135deg,#1e3440,#25352f);border:1px solid #40564c;border-radius:8px}.akame-board .akame-avatar{height:54px}.akame-modal-traits{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.akame-modal-traits span{padding:6px 9px;background:#292632;border-radius:5px;color:#ded5e8}.akame-note{color:#aaa5b1;line-height:1.5;margin-top:12px}
        @media(max-width:520px){.akame-stats{gap:6px}.akame-units{grid-template-columns:repeat(4,1fr)}.akame-board{grid-template-columns:repeat(4,1fr)}}
      `}</style>
      <div className="akame-top">
        <div><div className="akame-brand">AKAME <span style={{color:'#c69af0'}}>TFT</span></div><div className="akame-live">● AO VIVO · MOCKUP</div></div>
        <div className="akame-stats"><span>HP <b>72</b></span><span>LV <b>6</b></span><span>GOLD <b>38</b></span></div>
      </div>

      <section className="akame-comp">
        <div className="akame-label">Sua composição</div>
        <div className="akame-comp-head"><div className="akame-comp-title">Arcanistas Flex <span style={{color:'#aaa5b1',fontSize:10}}>· 6/8</span></div><button className="akame-open" onClick={() => setExpanded(true)}>Ver comp. completa ↗</button></div>
        <div className="akame-units">
          {units.slice(0, 6).map(unit => <div className="akame-unit" key={unit.name}><div className="akame-avatar">{unit.mark}</div><small>{unit.name}</small></div>)}
        </div>
        <div className="akame-traits"><span className="akame-trait">✦ Arcanista 4</span><span className="akame-trait">⚙ Sucateiro 2</span><span className="akame-trait">◎ Atirador 1</span></div>
      </section>

      <section className="akame-decision">
        <div className="akame-decision-head"><span className="akame-label">Recomendação agora</span><span className="akame-priority">◆ PRIORIDADE ALTA</span></div>
        <h3>{action.title}</h3><div className="akame-detail">{action.detail}</div>
        <p className="akame-reason">{action.reason}</p>
        <div className="akame-action-row">
          {(['XP','ROLL','BUY'] as ActionKind[]).map(kind => <button key={kind} className={`akame-action ${activeAction === kind ? 'active' : ''}`} onClick={() => setActiveAction(kind)}>{kind === 'XP' ? '↑ XP' : kind === 'ROLL' ? '⟳ ROLL' : '＋ COMPRA'}</button>)}
        </div>
      </section>

      <div className="akame-bottom"><span>Plano: <b>Fast 8 · Transição</b></span><span className="akame-tag">Confiança 84%</span></div>

      {expanded && <div className="akame-modal-backdrop" onClick={() => setExpanded(false)}>
        <div className="akame-modal" onClick={event => event.stopPropagation()}>
          <div className="akame-modal-head"><div><div className="akame-label">AKAME · PLANO DE TABULEIRO</div><h2>Arcanistas Flex — composição completa</h2></div><button className="akame-open" onClick={() => setExpanded(false)}>Fechar ✕</button></div>
          <div className="akame-label" style={{marginBottom:8}}>Posicionamento sugerido · nível 8</div>
          <div className="akame-board">{units.map(unit => <div className="akame-unit" key={unit.name}><div className="akame-avatar">{unit.mark}</div><small>{unit.name}</small></div>)}</div>
          <div className="akame-modal-traits"><span>✦ Arcanista 4</span><span>⚙ Sucateiro 2</span><span>◎ Atirador 2</span><span>◇ Flex 2</span></div>
          <p className="akame-note">A composição é ilustrativa. Na versão integrada, unidades, sinergias, funções e posicionamento serão preenchidos pelo plano estratégico recebido do motor da IA.</p>
        </div>
      </div>}
    </div>
  );
};

export default TFTCoachOverlay;
