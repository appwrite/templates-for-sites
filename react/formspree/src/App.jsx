import { useState } from 'react'
import './App.css'
import { useForm, ValidationError } from "@formspree/react";

function App() {
  const [state, handleSubmit] = useForm("FORM_ID");

  if (state.succeeded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-2xl w-full p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-4">Thanks for joining!</h2>
          <p className="text-center text-gray-600">We'll get back to you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Job Application Form</h1>
          <p className="text-gray-600">Please fill out the form below to apply for the position</p>
        </div>

        <form className="bg-white shadow-lg rounded-lg p-8" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Personal Information Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">Personal Information</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="name">
                    Full Name
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="name"
                    name="name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dob">
                    Date of Birth
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="dob"
                    name="dob"
                    placeholder="MM-DD-YYYY"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                    Email
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="email"
                    name="email"
                    type="email"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="number">
                    Contact Number
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="number"
                    name="number"
                    placeholder="(000) 000-0000"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Address Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">Address</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="address-1">
                    Address line 1
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="address-1"
                    name="address-1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="address-2">
                    Address line 2
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="address-2"
                    name="address-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="city">
                      City
                    </label>
                    <input
                      className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                      id="city"
                      name="city"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="state">
                      State
                    </label>
                    <input
                      className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                      id="state"
                      name="state"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="zip-code">
                    Postal / Zip Code
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="zip-code"
                    name="zip-code"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Employment History Section */}
          <div className="mt-12 space-y-6">
            <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">Employment History</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="previous-company">
                    Latest Employer
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="previous-company"
                    name="previous-company"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="previous-role">
                    Latest Role
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="previous-role"
                    name="previous-role"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="latest-role-start-date">
                    Start Date
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="latest-role-start-date"
                    name="latest-role-start-date"
                    placeholder="MM-YYYY"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="latest-role-end-date">
                    End Date
                  </label>
                  <input
                    className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                    id="latest-role-end-date"
                    name="latest-role-end-date"
                    placeholder="MM-YYYY (Leave blank if current)"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="role-description">
                  Role Description
                </label>
                <textarea
                  className="w-full px-4 py-2 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200 min-h-[100px]"
                  id="role-description"
                  name="role-description"
                />
              </div>
            </div>
          </div>

          {/* Application Details Section */}
          <div className="mt-12 space-y-6">
            <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">Application Details</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dates">
                  Position
                </label>
                <select
                  className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200 appearance-none bg-white"
                  id="dates"
                  name="dates"
                >
                  <option value="software-engineer">Software Engineer</option>
                  <option value="senior-software-engineer">Senior Software Engineer</option>
                  <option value="ux-designer">UX Designer</option>
                  <option value="marketing-specialist">Marketing Specialist</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="start-date">
                  Available Start Date
                </label>
                <input
                  className="w-full h-10 px-4 rounded-lg outline outline-1 outline-gray-400 hover:outline-gray-600 focus:outline-2 focus:outline-blue-500 transition-all duration-200"
                  id="start-date"
                  name="start-date"
                  type="date"
                />
              </div>
            </div>
          </div>

          <div className="mt-8">
            <button
              type="submit"
              disabled={state.submitting}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.submitting ? 'Submitting...' : 'Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App
