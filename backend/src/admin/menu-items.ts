export interface MenuItemDef {
    key: string;
    label: string;
    section: string;
}

export const MENU_ROLES: string[] = [
    'admin',
    'physician',
    'nurse',
    'front_desk',
    'midwife',
    'lab_tech',
    'billing',
    'inventory_manager',
];

export const MENU_ITEMS: MenuItemDef[] = [
    { key: '/dashboard', label: 'Clinic Overview', section: 'Dashboard' },
    {
        key: '/provider-dashboard',
        label: 'Provider Dashboard',
        section: 'Dashboard',
    },
    { key: '/nurse-dashboard', label: 'Nurse Dashboard', section: 'Dashboard' },
    {
        key: '/midwife-dashboard',
        label: 'Midwife Dashboard',
        section: 'Dashboard',
    },
    {
        key: '/lab-tech-dashboard',
        label: 'Lab Tech Dashboard',
        section: 'Dashboard',
    },
    {
        key: '/registrar-dashboard',
        label: 'Registrar Dashboard',
        section: 'Dashboard',
    },

    { key: '/patients', label: 'Search & Register', section: 'Patients' },
    { key: '/providers', label: 'Providers', section: 'Patients' },

    { key: '/appointments', label: 'Calendar', section: 'Appointments' },
    {
        key: '/appointments/flow',
        label: 'Patient Flow',
        section: 'Appointments',
    },
    {
        key: '/appointments/recall',
        label: 'Recall Board',
        section: 'Appointments',
    },
    {
        key: '/appointments/screening',
        label: 'Drug Screening',
        section: 'Appointments',
    },
    { key: '/inpatient', label: 'Inpatient / ADT', section: 'Appointments' },

    { key: '/lab-dashboard', label: 'Lab Management', section: 'Laboratory' },
    { key: '/labs', label: 'Lab Orders', section: 'Laboratory' },

    { key: '/inventory', label: 'Inventory', section: 'Inventory' },

    { key: '/referrals', label: 'Referrals', section: 'Clinical' },
    { key: '/cds', label: 'Decision Support', section: 'Clinical' },
    { key: '/group-therapy', label: 'Group Therapy', section: 'Clinical' },
    { key: '/fda', label: 'FDA Lookup', section: 'Clinical' },
    { key: '/drug-info', label: 'Drug Info', section: 'Clinical' },
    { key: '/templates', label: 'Templates', section: 'Clinical' },
    { key: '/pharmacy', label: 'Pharmacy', section: 'Clinical' },

    { key: '/messages', label: 'Inbox', section: 'Messaging' },
    {
        key: '/messages/patient-chat',
        label: 'Patient Chat',
        section: 'Messaging',
    },
    { key: '/direct-messaging', label: 'Direct Msg', section: 'Messaging' },

    { key: '/billing', label: 'Billing Dashboard', section: 'Billing' },
    { key: '/billing/medical', label: 'Medical Billing', section: 'Billing' },

    { key: '/documents', label: 'Secure Documents', section: 'Documents' },
    { key: '/dicom', label: 'DICOM / X-Ray', section: 'Documents' },

    { key: '/reports', label: 'Reports', section: 'Reports' },
    { key: '/reports/surveillance', label: 'Surveillance', section: 'Reports' },

    { key: '/admin', label: 'System Admin', section: 'Admin' },
    { key: '/db-admin', label: 'Database Admin', section: 'Admin' },
    { key: '/disclosures', label: 'Disclosures', section: 'Admin' },
    { key: '/license', label: 'License', section: 'Admin' },

    { key: '/how-to', label: 'How-To Guide', section: 'Help' },
    { key: '/wiki', label: 'Wiki / Docs', section: 'Help' },
    { key: '/community', label: 'Community Forum', section: 'Help' },
    { key: '/help', label: 'FAQ & Help', section: 'Help' },
];
