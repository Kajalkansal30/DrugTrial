import React from 'react';
import { Stepper, Step, StepLabel, Box } from '@mui/material';

const steps = ['Upload Protocol', 'Review FDA Forms', 'Analyze Criteria', 'Patient Screening'];

const WorkflowStepper = ({ activeStep }) => {
    return (
        <Box sx={{ width: '100%', mb: 4 }}>
            <Stepper activeStep={activeStep} alternativeLabel>
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>
        </Box>
    );
};

export default WorkflowStepper;
