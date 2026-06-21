'use client';

import React, { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import MigrationAssistant from '@/components/MigrationAssistant';
import DashboardView from '@/components/DashboardView';

// Stub imports for views that we will implement next
import InventoryView from '@/components/InventoryView';
import CustomersView from '@/components/CustomersView';
import SuppliersView from '@/components/SuppliersView';
import InvoicesView from '@/components/InvoicesView';
import BillingView from '@/components/BillingView';
import ReportsView from '@/components/ReportsView';
import SettingsView from '@/components/SettingsView';
import LedgerView from '@/components/LedgerView';
import SalesReturnsView from '@/components/SalesReturnsView';
import PurchaseReturnsView from '@/components/PurchaseReturnsView';
import FinancePartnersView from '@/components/FinancePartnersView';

export default function Home() {
  const [activePage, setActivePage] = useState<string>('dashboard');
  const [userRole] = useState<string>('Admin');
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const handleMigrationComplete = () => {
    // Force re-render of current view to update metrics from migrated database
    setRefreshKey(prev => prev + 1);
  };

  const PAGE_TITLES: Record<string, string> = {
    dashboard: 'Dashboard Overview',
    invoices: 'Invoice Records',
    billing: 'Billing Terminal',
    inventory: 'Inventory & Stock Master',
    customers: 'Customer Master Directory',
    suppliers: 'Supplier Master Directory',
    ledger: 'Customer Outstanding Ledger',
    'sales-return': 'Sales Return Desk',
    'purchase-return': 'Purchase Return Desk',
    reports: 'Business & Tax Analytics',
    'finance-partners': 'Finance Partner Dashboard',
    settings: 'System Configuration & Backups',
  };

  const renderContent = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardView key={refreshKey} />;
      case 'inventory':
        return <InventoryView key={refreshKey} />;
      case 'customers':
        return <CustomersView key={refreshKey} />;
      case 'suppliers':
        return <SuppliersView key={refreshKey} />;
      case 'invoices':
        return <InvoicesView key={refreshKey} setPage={setActivePage} />;
      case 'billing':
        return <BillingView key={refreshKey} setPage={setActivePage} />;
      case 'reports':
        return <ReportsView key={refreshKey} />;
      case 'settings':
        return <SettingsView key={refreshKey} />;
      case 'ledger':
        return <LedgerView key={refreshKey} />;
      case 'sales-return':
        return <SalesReturnsView key={refreshKey} />;
      case 'purchase-return':
        return <PurchaseReturnsView key={refreshKey} />;
      case 'finance-partners':
        return <FinancePartnersView key={refreshKey} />;
      default:
        return <DashboardView key={refreshKey} />;
    }
  };

  return (
    <div id="root-inner">
      <Sidebar activePage={activePage} setActivePage={setActivePage} role={userRole} />

      <main className="main">
        <header className="topbar">
          <h2>{PAGE_TITLES[activePage] || "Jiya's Arcade Billing"}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: 'var(--gray)', fontWeight: 600 }}>
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </header>

        <section className="page-content">
          {/* Migration Banner - visible only when legacy localStorage data is detected */}
          <MigrationAssistant onMigrationComplete={handleMigrationComplete} />
          
          {/* Active View Render */}
          {renderContent()}
        </section>
      </main>
    </div>
  );
}
