export default function Logo({ className = "h-14 w-auto" }) {
  return <img src="/assets/logo.png" alt="Faculty logo" className={`${className} object-contain`} />;
}
