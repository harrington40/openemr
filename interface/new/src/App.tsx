 import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';
import CallbackPage from './features/auth/CallbackPage';
import DashboardPage from './features/patients/DashboardPage';
import PatientSearchPage from './features/patients/PatientSearchPage';
import PatientDetailPage from './features/patients/PatientDetailPage';
import AppointmentCalendarPage from './features/appointments/AppointmentCalendarPage';
import PatientFlowBoard from './features/appointments/PatientFlowBoard';
import EncounterListPage from './features/encounters/EncounterListPage';
import EncounterDetailPage from './features/encounters/EncounterDetailPage';
import StartScreeningPage from './features/encounters/StartScreeningPage';
import DischargeSummaryPage from './features/encounters/DischargeSummaryPage';
import PatientRoundsPage from './features/encounters/PatientRoundsPage';
import BillingDashboardPage from './features/billing/BillingDashboardPage';
import ReportsPage from './features/reports/ReportsPage';
import AdminPage from './features/admin/AdminPage';
import LabsPage from './features/labs/LabsPage';
import LabDashboardPage from './features/labs/LabDashboardPage';
import RecallBoard from './features/appointments/RecallBoard';
import DrugScreeningPage from './features/appointments/DrugScreeningPage';
import PharmacyPage from './features/pharmacy/PharmacyPage';
import ReferralsPage from './features/referrals/ReferralsPage';
import SurveillancePage from './features/reports/SurveillancePage';
import DicomViewerPage from './features/dicom/DicomViewerPage';
import EyeExamPage from './features/eye/EyeExamPage';
import DirectMessagingPage from './features/direct/DirectMessagingPage';
import PatientLoginPage from './features/portal/PatientLoginPage';
import PatientPortalDashboard from './features/portal/PatientPortalDashboard';
import PatientMessagePage from './features/portal/PatientMessagePage';
import PatientPaymentPage from './features/portal/PatientPaymentPage';
import PatientRecordsPage from './features/portal/PatientRecordsPage';
import PatientRegistrationPage from './features/portal/PatientRegistrationPage';
import PatientChangePasswordPage from './features/portal/PatientChangePasswordPage';
import DisclosuresPage from './features/disclosures/DisclosuresPage';
import GroupTherapyPage from './features/therapy/GroupTherapyPage';
import TemplatesPage from './features/templates/TemplatesPage';
import CamosPage from './features/camos/CamosPage';
import MedicalBillingPage from './features/billing/MedicalBillingPage';
import ClinicalDecisionSupport from './features/cds/ClinicalDecisionSupport';
import ProvidersPage from './features/providers/ProvidersPage';
import ProviderDashboardPage from './features/provider/ProviderDashboardPage';
import ProviderProfilePage from './features/provider/ProviderProfilePage';
import FdaLookupPage from './features/fda/FdaLookupPage';
import DrugInfoPage from './features/fda/DrugInfoPage';
import NurseAideDashboardPage from './features/nurse/NurseAideDashboardPage';
import NurseRNDashboardPage from './features/nurse/NurseRNDashboardPage';
import RegistrarDashboardPage from './features/registrar/RegistrarDashboardPage';
import MidwifeDashboardPage from './features/midwife/MidwifeDashboardPage';
import LabTechDashboardPage from './features/labtech/LabTechDashboardPage';
import MessagesPage from './features/messages/MessagesPage';
import PatientChatPage from './features/messages/PatientChatPage';
import DocumentsPage from './features/documents/DocumentsPage';
import HelpFaqPage from './features/help/HelpFaqPage';
import HowToPage from './features/help/HowToPage';
import LicensePage from './features/license/LicensePage';
import DbAdminPage from './features/admin/DbAdminPage';
import WikiPage from './features/help/WikiPage';
import CommunityForumPage from './features/help/CommunityForumPage';
import InpatientDashboardPage from './features/inpatient/InpatientDashboardPage';
import EmergencyBoardPage from './features/emergency/EmergencyBoardPage';
import InventoryPage from './features/inventory/InventoryPage';
import VendorPortalPage from './features/inventory/VendorPortalPage';
import BookAppointmentPage from './features/booking/BookAppointmentPage';
import BookingsPage from './features/booking/BookingsPage';
import LabResultFormPage from './features/labreports/LabResultFormPage';

function RoleRedirect() {
  const { user } = useAuth();
  if (user?.main_menu_role === 'registered_nurse') return <Navigate to="/rn-dashboard" replace />;
  if (user?.role === 'nurse') return <Navigate to="/nurse-dashboard" replace />;
  if (user?.role === 'front_desk') return <Navigate to="/registrar-dashboard" replace />;
  if (user?.role === 'physician') return <Navigate to="/provider-dashboard" replace />;
  if (user?.role === 'midwife') return <Navigate to="/midwife-dashboard" replace />;
  if (user?.role === 'lab_tech') return <Navigate to="/lab-tech-dashboard" replace />;
  if (user?.role === 'inventory_manager') return <Navigate to="/inventory" replace />;
  if (user?.role === 'pharmacist') return <Navigate to="/pharmacy" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Patient Portal routes (public) */}
        <Route path="/portal/login" element={<PatientLoginPage />} />
        <Route path="/portal/dashboard" element={<PatientPortalDashboard />} />
        <Route path="/portal/message" element={<PatientMessagePage />} />
        <Route path="/portal/payment" element={<PatientPaymentPage />} />
        <Route path="/portal/records" element={<PatientRecordsPage />} />
        <Route path="/portal/register" element={<PatientRegistrationPage />} />
        <Route path="/portal/change-password" element={<PatientChangePasswordPage />} />

        {/* Public routes */}
        <Route path="/vendor/portal/:token" element={<VendorPortalPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="/license" element={<LicensePage />} />
        <Route path="/book-appointment" element={<BookAppointmentPage />} />

        {/* Protected routes */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<RoleRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/patients" element={<PatientSearchPage />} />
          <Route path="/patients/:id" element={<PatientDetailPage />} />
          <Route path="/patients/:id/encounters" element={<EncounterListPage />} />
          <Route path="/patients/:id/encounters/:encounterId" element={<EncounterDetailPage />} />
          <Route path="/patients/:pid/screening" element={<StartScreeningPage />} />
          <Route path="/patients/:pid/discharge-summary" element={<DischargeSummaryPage />} />
          <Route path="/patients/:pid/rounds" element={<PatientRoundsPage />} />
          <Route path="/appointments" element={<AppointmentCalendarPage />} />
          <Route path="/appointments/flow" element={<PatientFlowBoard />} />
          <Route path="/appointments/recall" element={<RecallBoard />} />
          <Route path="/appointments/screening" element={<DrugScreeningPage />} />
            <Route path="/inpatient" element={<InpatientDashboardPage />} />
            <Route path="/emergency" element={<EmergencyBoardPage />} />
          <Route path="/billing" element={<BillingDashboardPage />} />
          <Route path="/billing/medical" element={<MedicalBillingPage />} />
          <Route path="/cds" element={<ClinicalDecisionSupport />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/surveillance" element={<SurveillancePage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/providers/:id" element={<ProviderProfilePage />} />
          <Route path="/provider-dashboard" element={<ProviderDashboardPage />} />
          <Route path="/nurse-dashboard" element={<NurseAideDashboardPage />} />
          <Route path="/rn-dashboard" element={<NurseRNDashboardPage />} />
          <Route path="/midwife-dashboard" element={<MidwifeDashboardPage />} />
          <Route path="/lab-tech-dashboard" element={<LabTechDashboardPage />} />
          <Route path="/lab-dashboard" element={<LabDashboardPage />} />
          <Route path="/registrar-dashboard" element={<RegistrarDashboardPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/pharmacy" element={<PharmacyPage />} />
          <Route path="/referrals" element={<ReferralsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/patient-chat" element={<PatientChatPage />} />
          <Route path="/messages/patient-chat/:pid" element={<PatientChatPage />} />
          <Route path="/eye-exam" element={<EyeExamPage />} />
          <Route path="/direct-messaging" element={<DirectMessagingPage />} />
          <Route path="/dicom" element={<DicomViewerPage />} />
          <Route path="/disclosures" element={<DisclosuresPage />} />
          <Route path="/group-therapy" element={<GroupTherapyPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/camos" element={<CamosPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/lab-results" element={<LabResultFormPage />} />
          <Route path="/lab-results/:pid" element={<LabResultFormPage />} />
          <Route path="/fda" element={<FdaLookupPage />} />
          <Route path="/drug-info" element={<DrugInfoPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/db-admin" element={<DbAdminPage />} />
          <Route path="/wiki" element={<WikiPage />} />
          <Route path="/help" element={<HelpFaqPage />} />
          <Route path="/how-to" element={<HowToPage />} />
          <Route path="/community" element={<CommunityForumPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
