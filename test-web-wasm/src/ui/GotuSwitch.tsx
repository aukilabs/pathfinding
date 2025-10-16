import { Switch } from "react-aria-components";

type Props = {
  isSelected: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
  ariaLabel?: string;
};

export default function GotuSwitch({
  isSelected,
  onChange,
  children,
  ariaLabel,
}: Props) {
  return (
    <div className="flex flex-row m-2 gap-2.5 items-center">
      <Switch
        className="group relative flex"
        isSelected={isSelected}
        onChange={(value) => {
          onChange(value);
        }}
        aria-label={ariaLabel}
      >
        <div className="flex h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full shadow-inner bg-clip-padding border border-solid border-white/30 p-[3px] box-border transition duration-200 ease-in-out bg-gray-300 group-pressed:bg-gray-400 group-selected:bg-gotu-blue group-selected:group-pressed:bg-gotu-blue outline-hidden group-focus-visible:ring-2 ring-black">
          <span className="h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out translate-x-0 group-selected:translate-x-[100%]" />
        </div>
      </Switch>
      {children}
    </div>
  );
}
