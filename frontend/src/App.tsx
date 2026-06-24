import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth.store';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { Categories } from './pages/Categories';
import { Suppliers } from './pages/Suppliers';
import { Items } from './pages/Items';
import { Products } from './pages/Products';
import { Import } from './pages/Import';
import { Quotations } from './pages/Quotations';
import { QuotationDetailPage } from './pages/QuotationDetail';
import { Orders } from './pages/Orders';
import { OrderDetailPage } from './pages/OrderDetail';
import { Requests } from './pages/Requests';
import { RequestDetailPage } from './pages/RequestDetail';
import { UsersPage } from './pages/Users';
import { Delivery } from './pages/Delivery';
import { DeliveryOrderDetailPage } from './pages/Delivery/OrderDetail';
import { Integrations } from './pages/Integrations';
import { JSX } from 'react';

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuth((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="delivery/:id" element={<DeliveryOrderDetailPage />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="requests" element={<Requests />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="categories" element={<Categories />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="items" element={<Items />} />
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
