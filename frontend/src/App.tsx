import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth.store';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { Categories } from './pages/Categories';
import { Suppliers } from './pages/Suppliers';

import { Products } from './pages/Products';
import { Import } from './pages/Import';
import { Quotations } from './pages/Quotations';
import { QuotationDetailPage } from './pages/QuotationDetail';
import { Orders } from './pages/Orders';
import { OrderDetailPage } from './pages/OrderDetail';
import { Requests } from './pages/Requests';
import { Contagens } from './pages/Estoque/Contagens';
import { ContagemDetail } from './pages/Estoque/ContagemDetail';
import { Parametros } from './pages/Estoque/Parametros';
import { RequestDetailPage } from './pages/RequestDetail';
import { UsersPage } from './pages/Users';
import { ChangePassword } from './pages/ChangePassword';
import { AuditPage } from './pages/Audit';
import { BrandingPage } from './pages/Branding';
import { Delivery } from './pages/Delivery';
import { DeliveryOrderDetailPage } from './pages/Delivery/OrderDetail';
import { DeliveryMap } from './pages/Delivery/Map';
import { OrderReceipt } from './pages/Delivery/OrderReceipt';
import { Integrations } from './pages/Integrations';
import { Reports } from './pages/Reports';
import { Store } from './pages/Store';
import { MenuPage } from './pages/Menu';
import { CompanyOrder } from './pages/Marmitex/CompanyOrder';
import { MarmitexCompanies } from './pages/Marmitex/Companies';
import { MarmitexCatalogPage } from './pages/Marmitex/Catalog';
import { MarmitexReportPage } from './pages/Marmitex/Report';
import { MarmitexInvoices } from './pages/Marmitex/Invoices';
import { LabelsPrint } from './pages/Marmitex/LabelsPrint';
import { Vendas } from './pages/Vendas';
import { VendasStations } from './pages/Vendas/Stations';
import { JSX, useEffect } from 'react';
import { useBrand } from './store/brand.store';

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuth((s) => s.token);
  const mustChange = useAuth((s) => !!s.user?.must_change_password);
  if (!token) return <Navigate to="/login" replace />;
  // Senha provisória (1º login / reset): obriga a troca antes de usar o app.
  if (mustChange) return <ChangePassword />;
  return children;
}

/** Home por papel: empresa-cliente cai na própria área; staff no dashboard. */
function RoleHome() {
  const role = useAuth((s) => s.user?.role);
  return role === 'company' ? <Navigate to="/marmitex" replace /> : <Dashboard />;
}

export default function App() {
  const loadBrand = useBrand((s) => s.load);
  const refreshAuth = useAuth((s) => s.refresh);
  useEffect(() => { loadBrand(); }, [loadBrand]);
  // Ressincroniza permissões no boot: sem isso, tela nova (ou papel alterado pelo
  // admin) só aparecia depois de deslogar e logar de novo.
  useEffect(() => { refreshAuth(); }, [refreshAuth]);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Impressão de etiquetas: rota isolada (sem o chrome do app) para o window.print(). */}
      <Route
        path="/marmitex/labels/print"
        element={
          <Protected>
            <LabelsPrint />
          </Protected>
        }
      />
      {/* Comanda de delivery: rota isolada (sem o chrome do app) para o window.print(). */}
      <Route
        path="/delivery/:id/print"
        element={
          <Protected>
            <OrderReceipt />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<RoleHome />} />
        <Route path="marmitex" element={<CompanyOrder />} />
        <Route path="marmitex/companies" element={<MarmitexCompanies />} />
        <Route path="marmitex/catalog" element={<MarmitexCatalogPage />} />
        <Route path="marmitex/report" element={<MarmitexReportPage />} />
        <Route path="marmitex/invoices" element={<MarmitexInvoices />} />
        <Route path="vendas" element={<Vendas />} />
        <Route path="vendas/estacoes" element={<VendasStations />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="delivery/mapa" element={<DeliveryMap />} />
        <Route path="delivery/:id" element={<DeliveryOrderDetailPage />} />
        <Route path="relatorios" element={<Reports />} />
        <Route path="cardapio" element={<MenuPage />} />
        <Route path="loja" element={<Store />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="estoque/parametros" element={<Parametros />} />
        <Route path="estoque/contagem" element={<Contagens />} />
        <Route path="estoque/contagem/:id" element={<ContagemDetail />} />
        <Route path="requests" element={<Requests />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="personalizacao" element={<BrandingPage />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="categories" element={<Categories />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="items" element={<Navigate to="/products?view=itens" replace />} />
        <Route path="products" element={<Products />} />
        <Route path="import" element={<Import />} />
        <Route path="quotations" element={<Quotations />} />
        <Route path="quotations/:id" element={<QuotationDetailPage />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
