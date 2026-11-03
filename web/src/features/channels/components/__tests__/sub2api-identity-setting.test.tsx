import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, test, vi } from "vitest";

import { Form } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  type ChannelFormValues,
} from "../../lib/channel-form";
import { Sub2APIIdentitySetting } from "../sub2api-identity-setting";

function SettingsForm({
  headers = "",
  type = 59,
  onSave,
}: {
  headers?: string;
  type?: number;
  onSave: (values: ChannelFormValues) => void;
}) {
  const form = useForm<ChannelFormValues>({
    defaultValues: {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type,
      header_override: headers,
    },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)}>
        <Sub2APIIdentitySetting />
        <Textarea
          aria-label="Header overrides"
          {...form.register("header_override")}
        />
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

describe("Sub2API user attribution settings", () => {
  test("enables identity and saves a source without changing compression headers", async () => {
    const user = userEvent.setup(),
      save = vi.fn();
    render(
      <SettingsForm headers='{"Content-Encoding":"zstd"}' onSave={save} />,
    );
    await user.click(
      screen.getByRole("switch", { name: "Send user identity to Sub2API" }),
    );
    const input = screen.getByLabelText("Sub2API source ID");
    await user.clear(input);
    await user.type(input, "factory-east");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalled();
    expect(JSON.parse(save.mock.calls[0][0].header_override)).toEqual({
      "Content-Encoding": "zstd",
      "X-Sub2api-Source": "factory-east",
    });
  });
  test("disables identity while preserving unrelated header overrides", async () => {
    const user = userEvent.setup(),
      save = vi.fn();
    render(
      <SettingsForm
        headers='{"X-Sub2api-Source":"factory","Content-Encoding":"gzip"}'
        onSave={save}
      />,
    );
    await user.click(
      screen.getByRole("switch", { name: "Send user identity to Sub2API" }),
    );
    expect(
      screen.queryByLabelText("Sub2API source ID"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(JSON.parse(save.mock.calls[0][0].header_override)).toEqual({
      "Content-Encoding": "gzip",
    });
  });
  test("hides attribution on other providers and blocks editing invalid JSON", () => {
    const first = render(<SettingsForm type={1} onSave={vi.fn()} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    first.unmount();
    render(<SettingsForm headers="{" onSave={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });
});
