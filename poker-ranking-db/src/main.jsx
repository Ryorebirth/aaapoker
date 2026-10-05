import React from "react";
import ReactDOM from "react-dom/client";
import AdminApp from "./pages/AdminApp.jsx";
import BoardPage from "./pages/BoardPage.jsx";
import "./index.css";

const isBoard = window.location.pathname.replace(/\/+$/, "") === "/board";

ReactDOM.createRoot(document.getElementById("root")).render(isBoard ? <BoardPage /> : <AdminApp />);
