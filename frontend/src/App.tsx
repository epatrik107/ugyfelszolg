import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BusinessPage } from "./pages/BusinessPage";
import { CancelPage } from "./pages/CancelPage";
import { ContactPage } from "./pages/ContactPage";
import { HomePage } from "./pages/HomePage";
import { LetterCreationPage } from "./pages/LetterCreationPage";
import { PricingPage } from "./pages/PricingPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { SuccessPage } from "./pages/SuccessPage";
import { TermsPage } from "./pages/TermsPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/level-keszites" element={<LetterCreationPage />} />
        <Route path="/arak" element={<PricingPage />} />
        <Route path="/sikeres-fizetes" element={<SuccessPage />} />
        <Route path="/sikertelen-fizetes" element={<CancelPage />} />
        <Route path="/kapcsolat" element={<ContactPage />} />
        <Route path="/aszf" element={<TermsPage />} />
        <Route path="/adatkezeles" element={<PrivacyPage />} />
        <Route path="/ceges" element={<BusinessPage />} />
      </Routes>
    </Layout>
  );
}
