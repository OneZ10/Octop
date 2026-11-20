import { Navigate } from "react-router-dom";

/** 智能编写 menu opens the shared write expert in the native Octop chat. */
export default function OneMindWritePage() {
  return <Navigate to="/chat/write" replace />;
}
