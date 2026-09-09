import Link from "next/link";
import { DecorativeIllustration } from "@/components/decorative-illustration";
import { SignedOutFrame } from "@/components/signed-out-frame";
import "@/app/styles/landing.css";

// The 404 boundary of the whole application. It uses the signed-out frame because it is reached
// signed in and signed out alike, and the frame is the one shell that draws no destination a
// visitor may not be allowed to open. One illustration, one sentence, one button.
export default function NotFound() {
  return (
    <SignedOutFrame>
      <div className="landing-feedback">
        <DecorativeIllustration name="broken-link" variant="feedback" />
        <h1>This page was not found.</h1>
        <p>The link may be incomplete, or the record is no longer yours to open.</p>
        <div className="landing-feedback-actions">
          <Link href="/" className="button-link" prefetch={false}>
            Back to the start
          </Link>
        </div>
      </div>
    </SignedOutFrame>
  );
}
