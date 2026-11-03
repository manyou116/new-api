import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { sideDrawerSwitchItemClassName } from "@/components/drawer-layout";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { ChannelFormValues } from "../lib/channel-form";
import { parseHeaderOverrideObject } from "../lib/header-passthrough";

export function Sub2APIIdentitySetting({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const form = useFormContext<ChannelFormValues>();
  const id = useId();
  if (Number(form.watch("type")) !== 59) return null;

  return (
    <FormField
      control={form.control}
      name="header_override"
      render={({ field }) => {
        const headers = parseHeaderOverrideObject(field.value);
        const source = Object.entries(headers ?? {}).find(
          ([key]) => key.toLowerCase() === "x-sub2api-source",
        )?.[1];
        const enabled = source !== undefined;
        const locked = disabled || headers === null;
        const valid =
          typeof source === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(source);
        function update(value: string | null) {
          if (locked || !headers) return;
          const next = Object.fromEntries(
            Object.entries(headers).filter(
              ([key]) =>
                !["x-sub2api-source", "x-sub2api-user"].includes(
                  key.toLowerCase(),
                ),
            ),
          );
          if (value !== null) next["X-Sub2api-Source"] = value;
          field.onChange(
            Object.keys(next).length ? JSON.stringify(next, null, 2) : "",
          );
        }
        return (
          <div className="space-y-3">
            <FormItem className={sideDrawerSwitchItemClassName()}>
              <div className="space-y-0.5">
                <FormLabel>{t("Send user identity to Sub2API")}</FormLabel>
                <FormDescription>
                  {headers === null
                    ? t("Invalid JSON format")
                    : t(
                        "Send the authenticated user identity for usage attribution. Bind this channel key to the same source in Sub2API.",
                      )}
                </FormDescription>
              </div>
              <FormControl aria-invalid={false}>
                <Switch
                  checked={enabled}
                  disabled={locked}
                  onBlur={field.onBlur}
                  onCheckedChange={(checked) =>
                    update(checked ? "factory" : null)
                  }
                />
              </FormControl>
            </FormItem>
            {enabled && (
              <Field>
                <FieldLabel htmlFor={id}>{t("Sub2API source ID")}</FieldLabel>
                <Input
                  id={id}
                  value={typeof source === "string" ? source : ""}
                  disabled={locked}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_-]{1,64}"
                  required
                  aria-invalid={!valid}
                  onChange={(event) => update(event.target.value)}
                  onBlur={field.onBlur}
                />
              </Field>
            )}
          </div>
        );
      }}
    />
  );
}
