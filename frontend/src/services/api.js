import axios from 'axios';

const API = axios.create({ baseURL: '/api' });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('iw_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const register          = (d)      => API.post('/auth/register', d);
export const login             = (d)      => API.post('/auth/login',    d);
export const getReports        = (params) => API.get('/reports',        { params });
export const getMyReports      = ()       => API.get('/reports/manage');
export const getOrgLeadReports = ()       => API.get('/reports/lead-view');
export const getMapPoints      = ()       => API.get('/reports/map');
export const getReport         = (id)     => API.get(`/reports/${id}`);
export const createReport      = (d)      => API.post('/reports',       d);
export const updateStatus      = (id,s,note) => API.patch(`/reports/${id}/status`, note !== undefined ? { status: s, note } : { status: s });
export const getNotifications       = () => API.get('/notifications');
export const markNotificationRead   = (id) => API.patch(`/notifications/${id}/read`);
export const getMyReportHistory     = () => API.get('/reports/mine');
export const getStaffActivity       = () => API.get('/staff/activity');
export const downloadPdfReport      = () => API.get('/reports/pdf-summary', { responseType: 'blob' });
export const deleteReport      = (id)     => API.delete(`/reports/${id}`);
export const getFuelBrands     = ()       => API.get('/fuel/brands');
export const getFuelStations   = (brand)  => API.get('/fuel', { params: { brand } });
export const getFuelMapPoints  = (brand)  => API.get('/fuel/map', { params: { brand } });
export const updateStation     = (id,d)   => API.patch(`/fuel/${id}`,   d);
export const getOfficeTypes = ()          => API.get('/offices/types');
export const getHealthFacilities = ()     => API.get('/health');
export const getOffices     = (office_type) => API.get('/offices', { params: { office_type } });
export const getRoutes         = ()       => API.get('/transport');
export const updateRouteStatus = (id,s)   => API.patch(`/transport/${id}/status`, { status: s });
export const getOutage         = (district,year) => API.get('/outage', { params: { district, year } });
export const getOutageDistricts = ()      => API.get('/outage/districts');
export const getNearbyHealth   = (lat,lng,type,radius) => API.get('/health/nearby', { params: { lat, lng, type, radius } });
export const getFloodRisk      = (lat,lng) => API.get('/weather/flood-risk', { params: { lat, lng } });
export const classifyText      = (desc)   => API.post('/ml/classify-text',  { description: desc });
export const classifyImage     = (form)   => API.post('/ml/classify-image', form);
export const extractLocationHint = (desc) => API.post('/ml/extract-location', { description: desc });
export const changePassword    = (d)      => API.post('/auth/change-password', d);
export const applyOrganization = (d)      => API.post('/organizations', d);
export const getApprovedJurisdictions = () => API.get('/organizations/jurisdictions');
export const previewJurisdiction = (lat, lng) => API.get('/geocode/preview', { params: { lat, lng } });
export const getOrganizations  = (status) => API.get('/organizations', { params: { status } });
export const approveOrganization = (id, d) => API.post(`/organizations/${id}/approve`, d || {});
export const revokeOrganization  = (id)    => API.post(`/organizations/${id}/revoke`);
export const restoreOrganization = (id)    => API.post(`/organizations/${id}/restore`);
export const getOrgStaff       = ()       => API.get('/staff');
export const createOrgStaff    = (d)      => API.post('/staff', d);
export const revokeOrgStaff    = (id)     => API.patch(`/staff/${id}/revoke`);
export const restoreOrgStaff   = (id)     => API.patch(`/staff/${id}/restore`);
export const confirmReport = (id) => API.post(`/reports/${id}/confirm`);
export const getMyFuelStations = () => API.get('/fuel/manage');
export const createFuelStation = (d) => API.post('/fuel', d);
export const deleteFuelStation = (id) => API.delete(`/fuel/${id}`);

export const getMyOffices    = () => API.get('/offices/manage');
export const createOffice    = (d) => API.post('/offices', d);
export const updateOffice    = (id, d) => API.patch(`/offices/${id}`, d);
export const deleteOffice    = (id) => API.delete(`/offices/${id}`);

export const getMyRoutes     = () => API.get('/transport/manage');
export const createRoute     = (d) => API.post('/transport', d);
export const updateRoute     = (id, d) => API.patch(`/transport/${id}`, d);
export const deleteRoute     = (id) => API.delete(`/transport/${id}`);

export const getMyOutageRecords = () => API.get('/outage/manage');
export const createOutageRecord = (d) => API.post('/outage', d);
export const updateOutageRecord = (id, d) => API.patch(`/outage/${id}`, d);
export const deleteOutageRecord = (id) => API.delete(`/outage/${id}`);

export const getMyHealthFacilities = () => API.get('/health/manage');
export const createHealthFacility  = (d) => API.post('/health', d);
export const updateHealthFacility  = (id, d) => API.patch(`/health/${id}`, d);
export const deleteHealthFacility  = (id) => API.delete(`/health/${id}`);
export const verifyPhone = (code) => API.post('/auth/verify-phone', { code });
export const forgotPassword = (email) => API.post('/auth/forgot-password', { email });
export const resetPassword  = (d)     => API.post('/auth/reset-password', d); // { email, code, newPassword }
export const resendOtp   = ()     => API.post('/auth/resend-otp');

export default API;