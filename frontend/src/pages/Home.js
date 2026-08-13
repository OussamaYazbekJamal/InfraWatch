import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReports } from '../services/api';
import '../styles/home.css';

export default function Home() {
  const [stats, setStats] = useState({ total:0, pending:0, critical:0 });

  useEffect(() => {
    getReports().then(r => {
      const d = r.data;
      setStats({ total: d.length, pending: d.filter(x=>x.status==='pending').length, critical: d.filter(x=>x.severity==='critical').length });
    }).catch(()=>{});
  }, []);

  return (
    <main>
      <section className="hero-home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">Lebanon Infrastructure Monitor</div>
            <h1>Infrastructure updates, essential resources, and community reporting across Lebanon.</h1>
            <p>InfraWatch brings together electricity, fuel, roads, health, offices, and transportation in one civic platform — with AI-assisted reporting and live health facility lookup.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/report">Report an Issue</Link>
              <Link className="btn btn-secondary" to="/map">View Live Map</Link>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-card">
              <div className="hero-brand">
                <svg className="hero-logo" viewBox="0 0 36 36" fill="none">
                  <rect width="36" height="36" rx="6" fill="#1e40af"/>
                  <path d="M18 8L18 12M18 12L16 14L14 14L14 16M18 12L20 14L22 14L22 16M18 12L18 28M14 16L12 18L12 20M22 16L24 18L24 20M12 20L10 22L10 28M24 20L26 22L26 28M10 28L26 28"
                    stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="17" y="26" width="2" height="2" fill="#8b4513"/>
                </svg>
                <div><h2>InfraWatch</h2><p>Timely infrastructure information and civic resources in one place.</p></div>
              </div>
              <div className="status-list">
                <div className="status-item">
                  <div><strong>Total Reports</strong><small>{stats.total} submitted by citizens</small></div>
                  <span className="status-pill">Live</span>
                </div>
                <div className="status-item">
                  <div><strong>Pending Review</strong><small>{stats.pending} awaiting response</small></div>
                  <span className="status-pill" style={{background:'rgba(245,158,11,.2)',color:'#f59e0b',borderColor:'rgba(245,158,11,.3)'}}>Queue</span>
                </div>
                <div className="status-item">
                  <div><strong>Critical Issues</strong><small>{stats.critical} high-severity active</small></div>
                  <span className="status-pill" style={{background:'rgba(239,68,68,.15)',color:'#ef4444',borderColor:'rgba(239,68,68,.25)'}}>{stats.critical > 0 ? 'Alert' : 'Clear'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-header center">
            <h2>Main Pages</h2>
            <p>Explore the core services people need most when infrastructure conditions affect daily life.</p>
          </div>
          <div className="card-grid">
            {[
              ['⚡','Electricity','/electricity','Live outage chart by district, safety guidance, and citizen-reported grid incidents.'],
              ['⛽','Fuel',       '/fuel',       'Station availability, real-time prices, and crowdsourced shortage alerts.'],
              ['🚧','Roads',      '/roads',      'Road damage reports with photos, hazard categories, and severity ratings.'],
              ['❤', 'Health',     '/health',     'Find nearby hospitals, pharmacies, and clinics live based on your location.'],
              ['🚌','Transport',  '/transportation','Route schedules, live status, and active transit disruption reports.'],
              ['🏛️','Offices',  '/offices','Government offices opening hours, staff presence and availability. '],
              ['🗺','Live Map',   '/map',        'All reports and fuel stations on an interactive map — filtered by severity.'],
              ['📢','Report',    '/report',      'Submit an issue with GPS pin, photo, and AI-assisted severity classification.'],
            ].map(([icon,title,to,desc])=>(
              <div key={to} className="card">
                <div className="icon-badge" style={{marginBottom:'.75rem'}}>{icon}</div>
                <h3>{title}</h3><p>{desc}</p>
                <Link to={to}>Open page →</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-header center"><h2>Quick Access</h2></div>
          <div className="mini-grid">
            <Link className="resource-link" to="/about"><span>Public Resources</span><span>→</span></Link>
            <Link className="resource-link" to="/report"><span>Report Local Issues</span><span>→</span></Link>
            <Link className="resource-link" to="/health"><span>Find Nearby Health Facilities</span><span>→</span></Link>
            <Link className="resource-link" to="/map"><span>View Live Map</span><span>→</span></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
