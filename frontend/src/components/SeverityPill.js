import React from 'react';
const SeverityPill = ({ value }) => <span className={`pill pill-${value?.toLowerCase()}`}>{value}</span>;
export const StatusPill = ({ value }) => <span className={`pill pill-${value?.toLowerCase()}`}>{value}</span>;
export default SeverityPill;
