"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type CalendarProps = React.InputHTMLAttributes<HTMLInputElement> & {
  onSelect?: (date: Date | undefined) => void;
  selected?: Date;
}

function Calendar({ className, onSelect, selected, ...props }: CalendarProps) {

  const formatDateForInput = (date: Date | undefined) => {
    if (!date) return '';
    // Adjust for timezone offset to prevent date changes
    const adjustedDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return adjustedDate.toISOString().split('T')[0];
  }

  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const dateValue = event.target.value;
    if (onSelect) {
      if (dateValue) {
        // The input value is in 'YYYY-MM-DD' format, which is interpreted as UTC.
        // Creating a new Date from it will correctly represent the selected day.
        onSelect(new Date(dateValue + 'T00:00:00'));
      } else {
        onSelect(undefined);
      }
    }
  };
  
  return (
      <input 
        type="date"
        value={formatDateForInput(selected)}
        onChange={handleDateChange}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
