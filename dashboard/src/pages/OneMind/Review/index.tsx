import { Navigate } from "react-router-dom";

/** 智能审核 menu opens the shared check expert in the native Octop chat. */
export default function OneMindReviewPage() {
  return <Navigate to="/chat/check" replace />;
}
