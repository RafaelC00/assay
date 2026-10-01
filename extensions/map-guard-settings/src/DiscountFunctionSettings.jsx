import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useState, useMemo} from "preact/hooks";

export default async () => {
  render(<App />, document.body);
};

const KEY = "config";
const NAMESPACE = "$app:map-guard";

function parseConfig(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    const percentOff = Number(parsed.percentOff);
    return {
      percentOff: Number.isFinite(percentOff) && percentOff > 0 ? percentOff : 10,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : "Sale",
    };
  } catch {
    return {percentOff: 10, name: "Sale"};
  }
}

function App() {
  const {applyMetafieldChange, i18n, data} = shopify;

  const initial = useMemo(
    () =>
      parseConfig(
        data?.metafields?.find((m) => m.key === KEY && (!m.namespace || m.namespace === NAMESPACE))
          ?.value,
      ),
    [data?.metafields],
  );

  const [percentOff, setPercentOff] = useState(String(initial.percentOff));
  const [name, setName] = useState(initial.name);
  const pct = Number(percentOff);
  const valid = Number.isFinite(pct) && pct > 0 && pct <= 100;

  return (
    <s-function-settings
      onSubmit={(event) => {
        event.waitUntil?.(
          applyMetafieldChange({
            type: "updateMetafield",
            namespace: NAMESPACE,
            key: KEY,
            value: JSON.stringify({percentOff: pct, name: name.trim() || "Sale"}),
            valueType: "json",
          }),
        );
      }}
      onReset={() => {
        setPercentOff(String(initial.percentOff));
        setName(initial.name);
      }}
    >
      <s-section heading={i18n.translate("title")}>
        <s-stack gap="base">
          <s-text-field
            label={i18n.translate("saleName")}
            name="name"
            value={name}
            defaultValue={initial.name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <s-number-field
            label={i18n.translate("percentOff")}
            name="percentOff"
            value={percentOff}
            defaultValue={String(initial.percentOff)}
            min={1}
            max={100}
            suffix="%"
            error={valid ? undefined : i18n.translate("invalid")}
            onChange={(e) => setPercentOff(e.currentTarget.value)}
          />
          <s-text color="subdued">{i18n.translate("help")}</s-text>
        </s-stack>
      </s-section>
    </s-function-settings>
  );
}
