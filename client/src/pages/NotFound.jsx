import { useEffect } from "react";
import { Button, Empty } from "../components/ui";
import { Link, useLocation } from "../lib/router";

export default function NotFound() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = "Not found · DSMS";
  }, []);

  return (
    <div className="panel">
      <Empty
        icon="search"
        title="There is nothing at this address"
        action={
          <Link to="/">
            <Button variant="primary" iconRight="arrowRight">
              Back to the dashboard
            </Button>
          </Link>
        }
      >
        <span className="mono">{pathname}</span> did not match any page.
      </Empty>
    </div>
  );
}
