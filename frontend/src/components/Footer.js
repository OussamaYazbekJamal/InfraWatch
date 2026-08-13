import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <h3 className="footer-title">InfraWatch</h3>
            <p>Connecting citizens with essential infrastructure updates and community resources across Lebanon.</p>
            <p style={{marginTop:'.75rem',fontSize:'.8rem',color:'var(--navy-500)'}}>
              Live health data powered by OpenStreetMap · Overpass API
            </p>
          </div>
          <div>
            <h4 className="footer-title">Services</h4>
            <div className="footer-links">
              <Link to="/map">Live Map</Link>
              <Link to="/electricity">Electricity</Link>
              <Link to="/fuel">Fuel</Link>
              <Link to="/roads">Roads</Link>
              <Link to="/health">Health</Link>
              <Link to="/transportation">Transportation</Link>
              <Link to="/offices">Offices</Link>
              <Link to="/organizations/apply">Register your Organization</Link>
            </div>
          </div>
          <div>
            <h4 className="footer-title">Contact</h4>
            <div className="footer-links">
              <a href="mailto:info@infrawatch.lb">info@infrawatch.lb</a>
              <a href="tel:+96176145829">+961 76 145 829</a>
              <div className="socials">
                <a href="https://facebook.com"  aria-label="Facebook">f</a>
                <a href="https://twitter.com"   aria-label="Twitter">x</a>
                <a href="https://instagram.com" aria-label="Instagram">ig</a>
              </div>
              <Link to="/about">About &amp; Resources</Link>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          &copy; {new Date().getFullYear()} InfraWatch — Lebanon Infrastructure Monitor
        </div>
      </div>
    </footer>
  );
}