import React from 'react';
import { Link } from 'react-router-dom';

export default function About() {
  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="page-title">
            <div className="icon-badge">ℹ</div>
            <div><h1>About &amp; Resources</h1><p>Mission, civic purpose, AI technology, and supporting organizations.</p></div>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="grid-2" style={{marginBottom:'2rem'}}>
            <div className="panel">
              <h2 style={{marginBottom:'1rem'}}>Our Mission</h2>
              <p style={{color:'var(--navy-500)',lineHeight:1.75}}>InfraWatch reduces the information gap between citizens and essential infrastructure services. By centralizing electricity, fuel, roads, health, and transportation data — and using AI to classify reports — the platform supports better decisions and stronger community resilience.</p>
              <p style={{color:'var(--navy-500)',lineHeight:1.75,marginTop:'.85rem'}}>Live health facility data is powered by OpenStreetMap's Overpass API — completely free, community-maintained, and accurate for Lebanon.</p>
            </div>
            <div className="panel">
              <h3 style={{marginBottom:'1rem'}}>Technology Stack</h3>
              <div style={{display:'flex',flexDirection:'column',gap:'.75rem'}}>
                {[
                  ['🗺 Live Map','Leaflet.js + OpenStreetMap — free, open source'],
                  ['🏥 Health Facilities','OpenStreetMap Overpass API — real-time, no API key'],
                  ['🤖 NLP Classification','AraBERT — Lebanese dialect + Arabizi support'],
                  ['📸 Image AI','MobileNet — road damage classification'],
                  ['🗄 Database','Supabase PostgreSQL — cloud hosted'],
                  
                ].map(([t,d])=>(
                  <div key={t} style={{display:'flex',gap:'.75rem',alignItems:'flex-start',padding:'.65rem .85rem',background:'var(--gray-100)',borderRadius:'var(--radius-md)'}}>
                    <div style={{fontWeight:600,fontSize:'.875rem',whiteSpace:'nowrap'}}>{t}</div>
                    <div style={{fontSize:'.82rem',color:'var(--navy-500)'}}>{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card-grid">
            {[
              ['Ministry of Energy and Water','Official government energy policies and updates.','http://www.moew.gov.lb'],
              ['Lebanese Red Cross','Emergency services and community support.','https://www.redcross.org.lb'],
              ['UN Development Programme','International development and infrastructure support.','https://www.undp.org/lebanon'],
            ].map(([title,desc,href])=>(
              <div key={title} className="card">
                <h3>{title}</h3><p>{desc}</p>
                <a href={href} target="_blank" rel="noopener noreferrer">Visit website →</a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
