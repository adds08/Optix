"use client";
import "./d02.css";
import { D02Shell } from "@/components/d02/d02-shell";

export default function D02Layout({ children }: { children: React.ReactNode }) {
  return <D02Shell>{children}</D02Shell>;
}
