// 关键词策略构造器所需的最小图标集（全部 16×16 线性图标，颜色继承 currentColor）。
// 只为本页新增，未替换项目既有图标体系。
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function S({ children, className = "h-4 w-4", ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const ChevronDown = (p: IconProps) => (
  <S {...p}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const ChevronRight = (p: IconProps) => (
  <S {...p}><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const ChevronUp = (p: IconProps) => (
  <S {...p}><path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const ArrowLeft = (p: IconProps) => (
  <S {...p}><path d="M13 8H3m0 0 4-4m-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const ArrowUp = (p: IconProps) => (
  <S {...p}><path d="M8 13V3m0 0L4 7m4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const Search = (p: IconProps) => (
  <S {...p}>
    <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="m10.3 10.3 3.2 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);
export const Share = (p: IconProps) => (
  <S {...p}>
    <circle cx="12.4" cy="3.6" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="3.8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12.4" cy="12.4" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <path d="m5.5 7.1 5.2-2.6M5.5 8.9l5.2 2.6" stroke="currentColor" strokeWidth="1.3" />
  </S>
);
export const AddKeywords = (p: IconProps) => (
  <S {...p}>
    <path d="M8 2.8v6.4m0 0 2.6-2.6M8 9.2 5.4 6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.8 11.4v1.4c0 .4.3.6.6.6h9.2c.3 0 .6-.2.6-.6v-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);
export const Book = (p: IconProps) => (
  <S {...p}>
    <path d="M2.8 3.4h3.6c.9 0 1.6.7 1.6 1.6v7.4c0-.8-.6-1.4-1.4-1.4H2.8V3.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M13.2 3.4H9.6c-.9 0-1.6.7-1.6 1.6v7.4c0-.8.6-1.4 1.4-1.4h3.8V3.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </S>
);
export const Chat = (p: IconProps) => (
  <S {...p}>
    <path d="M2.6 3.4h10.8v7.2H7.2L3.9 13v-2.4H2.6V3.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </S>
);
export const Undo = (p: IconProps) => (
  <S {...p}>
    <path d="M3 6.2h5.6c2.2 0 3.8 1.4 3.8 3.4 0 2-1.6 3.4-3.8 3.4H6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5.4 3.6 2.8 6.2l2.6 2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);
export const Star = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <S {...p}>
    <path
      d="m8 2.4 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8L2.5 6.4l3.8-.5L8 2.4Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </S>
);
export const ZoomIn = (p: IconProps) => (
  <S {...p}>
    <circle cx="7" cy="7" r="4.3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 5.2v3.6M5.2 7h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="m10.2 10.2 3.2 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);
export const ZoomOut = (p: IconProps) => (
  <S {...p}>
    <circle cx="7" cy="7" r="4.3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.2 7h3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="m10.2 10.2 3.2 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);
export const Expand = (p: IconProps) => (
  <S {...p}>
    <path d="M6.2 2.8H2.8v3.4M9.8 2.8h3.4v3.4M6.2 13.2H2.8V9.8M9.8 13.2h3.4V9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);
export const GridView = (p: IconProps) => (
  <S {...p}>
    <rect x="2.6" y="2.6" width="4.6" height="4.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
    <rect x="8.8" y="2.6" width="4.6" height="4.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
    <rect x="2.6" y="8.8" width="4.6" height="4.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
    <rect x="8.8" y="8.8" width="4.6" height="4.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
  </S>
);
export const ListView = (p: IconProps) => (
  <S {...p}>
    <path d="M5.4 4h8M5.4 8h8M5.4 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="2.9" cy="4" r="0.9" fill="currentColor" />
    <circle cx="2.9" cy="8" r="0.9" fill="currentColor" />
    <circle cx="2.9" cy="12" r="0.9" fill="currentColor" />
  </S>
);
export const Download = (p: IconProps) => (
  <S {...p}>
    <path d="M8 2.8v7m0 0 2.6-2.6M8 9.8 5.4 7.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.8 11.4v1.4c0 .4.3.6.6.6h9.2c.3 0 .6-.2.6-.6v-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);
export const Sliders = (p: IconProps) => (
  <S {...p}>
    <path d="M2.6 4.6h10.8M2.6 8h10.8M2.6 11.4h10.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="6" cy="4.6" r="1.3" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="10.4" cy="8" r="1.3" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5" cy="11.4" r="1.3" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
  </S>
);
export const Question = (p: IconProps) => (
  <S {...p}>
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6.2 6.1a1.9 1.9 0 1 1 2.6 1.7c-.5.2-.8.6-.8 1.1v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
  </S>
);
export const Check = (p: IconProps) => (
  <S {...p}><path d="m3 8.4 3.2 3L13 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></S>
);
export const Cross = (p: IconProps) => (
  <S {...p}><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></S>
);
export const LinkIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M7 9.2 9.2 7a2.2 2.2 0 0 0-3.1-3.1L4 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M9 6.8 6.8 9a2.2 2.2 0 0 0 3.1 3.1L12 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </S>
);
export const VideoIcon = (p: IconProps) => (
  <S {...p}>
    <rect x="2.6" y="4.2" width="7.4" height="7.6" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="m10 7.4 3.4-1.9v5l-3.4-1.9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </S>
);
export const CartIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M2.4 3.2h1.8l1.2 6.2h6.4l1.2-4.6H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.4" cy="12.4" r="1" fill="currentColor" />
    <circle cx="11" cy="12.4" r="1" fill="currentColor" />
  </S>
);
export const ListLines = (p: IconProps) => (
  <S {...p}>
    <path d="M2.8 4h10.4M2.8 8h10.4M2.8 12h10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </S>
);
export const MessageSquare = (p: IconProps) => (
  <S {...p}>
    <path d="M2.8 3.6h10.4v7.2H8L5 13.2v-2.4H2.8V3.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M5.4 6.6h5.2M5.4 8.6h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </S>
);
export const SortIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M5 3.4v9.2m0 0L2.8 10.4M5 12.6l2.2-2.2M11 12.6V3.4m0 0L8.8 5.6M11 3.4l2.2 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);
