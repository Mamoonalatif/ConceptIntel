import { Check } from 'lucide-react';
import { cn } from '../../components/ui/utils';

const STEPS = [
  { id: 0, label: 'Basic Info', short: 'Info' },
  { id: 1, label: 'Outcomes', short: 'CLO/PLO' },
  { id: 2, label: 'Schedule', short: 'Schedule' },
  { id: 3, label: 'Enrollment', short: 'Access' },
  { id: 4, label: 'AI & Roadmap', short: 'AI' },
  { id: 5, label: 'Review', short: 'Review' },
];

interface CreationStepperProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function CreationStepper({ currentStep, onStepClick }: CreationStepperProps) {
  return (
    <div className="w-full">
      <div className="hidden md:flex items-center justify-between">
        {STEPS.map((step, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => onStepClick?.(i)}
                disabled={i > currentStep}
                className={cn(
                  'flex items-center gap-2 group',
                  i <= currentStep ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                )}
              >
                <div
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all',
                    done && 'bg-primary border-primary text-primary-foreground',
                    active && 'bg-primary/20 border-primary text-primary scale-110',
                    !done && !active && 'border-border text-muted-foreground'
                  )}
                >
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span
                  className={cn(
                    'text-sm font-medium hidden lg:block',
                    active ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-3 rounded',
                    i < currentStep ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile step indicator */}
      <div className="md:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-primary">
            Step {currentStep + 1} of {STEPS.length}
          </span>
          <span className="text-sm text-muted-foreground">{STEPS[currentStep].label}</span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export { STEPS };
